var fs = require( 'fs'),
    Promise = require( 'bluebird' ),
    http = require( 'http' ),
    readline = require( 'readline' ),
    Stream = require( 'stream' ),
    https = require( 'https' ),
    async = require(  'async'  ),
    colors = require( 'colors' ),
    path = require( 'path' );

var Translator = function() {},
    generateFileNameByUrl = function( url ) {
      var fileName,
          pattern = /\/videos\/([a-z\-0-9]+)/gi;

      fileName = pattern.exec( url );
      fileName = fileName[ 1 ].replace( '-video-tgl-ab-20-uhr-100', '' );

      return fileName + '.ttml';
    },

    getTargetFilePathByUrl = function( url ) {
      return __dirname + '/../subtitles/' +
             generateFileNameByUrl( url );
    },

    getTargetFilePathByFile = function( fileName ) {
      return __dirname + '/../subtitles/' + fileName;
    },

    getCacheFile = function( targetLang ) {
      return __dirname + '/../tatort-cache/' + targetLang + '.json'
    };

Translator.prototype.download = function( url ) {
  var downloadFile = function( url ) {
        var subtitleUrl = url.replace( '100.html', 'ut100.xml' ),
            data = '';

        return new Promise(function( resolve, reject ) {
          http.get( subtitleUrl, function parseResult( res ) {
            res.setEncoding( 'utf8' );

            if( res.statusCode !== 200 ) {
              return reject( new Error( 'URL has no subtitles' ) );
            }

            res.on( 'data', function( chunk ) {
              data += chunk;
            });

            res.on( 'end', function() {
              fs.writeFile( getTargetFilePathByUrl( url ), data, function() {
                resolve( generateFileNameByUrl( url ) );
              });
            });
          });
        });
      },

      subtitleExists = function( url ) {
        return new Promise(function( resolve, reject ) {
          fs.exists( getTargetFilePathByUrl( url ), function( exists ) {
            resolve( exists );
          });
        });
      };

    return subtitleExists( url )
      .then(function( exists ) {
        if( !exists ) {
          return downloadFile( url );
        } else {
          return generateFileNameByUrl( url );
        }
      });
};

Translator.prototype.translate = function( fileName, targetLang ) {
  var concurrentConnections = 20,
      sourcePath = getTargetFilePathByFile( fileName ),
      ast = {},

      generateSRT = function( ast ) {
        var data = '';

        for( var i in ast ) {
          data += '\n';
          data += i + '\n';
          data += ast[ i ].begin + ' --> ' + ast[ i ].end + '\n';
          data += ( ast[ i ].translation || ast[ i ].text ) + '\n';
        }

        /* Replaces ASCII Encoded Characters */
        data = data.replace( /&#(\d+);/g,
                        function ( m, n ) {
                          return String.fromCharCode( n );
                        });

        return writeResult( data, 'srt' )
                .then(function() {
                  return ast;
                });
      },

      writeResult = function( data, type, ast ) {
        var targetFilename = path.basename( sourcePath,
                                            path.extname( sourcePath ) ) +
                                            '-' + targetLang + '.' + type;

        return new Promise(function( resolve, reject ) {
          fs.writeFile( path.dirname( sourcePath ) +
                        '/' + targetFilename, data, function() {
                          resolve();
                        });
        });


      },

      readCache = function( targetLang ) {
        return new Promise(function( resolve, reject ) {
          var data = {};

          fs.exists( getCacheFile( targetLang ), function( exists ) {
            if( !exists ) {
              return resolve( data );
            }

            fs.readFile( getCacheFile( targetLang ), function( err, data ) {
              resolve( JSON.parse( data ) )
            });
          });
        });
      },

      /* generates cache file for a certain language */
      writeCache = function( ast, targetLang ) {
        var writeToFile = function( data ) {
              var hasChanges = false;

              for( var i in ast ) {
                if( !data[ ast[ i ].text ] ) {
                  data[ ast[ i ].text ] = ast[ i ].translation;
                  hasChanges = true;
                }
              }

              return new Promise(function( resolve, reject ) {
                if( hasChanges ) {
                  fs.writeFile( getCacheFile( targetLang ),
                                JSON.stringify( data ),
                                function() {
                                  resolve();
                                } );
                } else {
                  resolve();
                }
              });
            };

        return new Promise(function( resolve, reject ) {
          fs.exists( getCacheFile( targetLang ), function( exists ) {
            if( exists ) {
              fs.readFile( getCacheFile( targetLang ), function( err, data ) {
                writeToFile( JSON.parse( data ) )
                  .then( resolve() )
                  .catch( reject );
              });
            } else {
              writeToFile( {} )
                .then( resolve() )
                .catch( reject );
            }
          });
        });
      },

      /* Translate the whole AST */
      translateAST = function( ast, cache ) {
        return new Promise(function( resolve, reject ) {
          var doTranslation = function( value, key, callback ) {
            if( cache && cache[ value.text ] ) {
              ast[ key ].translation = cache[ value.text ];
              return callback( null );
            }

            translate( value.text )
              .then(function( translation ) {
                ast[ key ].translation = translation;
                callback( null );
              })
              .catch( reject );
          };

          async
            .forEachOfLimit( ast,
                             concurrentConnections,
                             doTranslation, function( err ) {
              if( err ) {
                return reject( err );
              }

              resolve( ast );
            });
        });
      },

      /* Translate a single string */
      translate = function( text ) {
        var api_key = 'AIzaSyCzK4Zi2w-ERWH2O4uGMrchoqiqEXBTAW8',
            url = 'https://www.googleapis.com/' +
                  'language/translate/v2' +
                  '?target=' + targetLang +
                  '&source=de' +
                  '&key=' + api_key +
                  '&q=' + text;

            return new Promise(function( resolve, reject ) {
              var parseTranslation = function( res ) {
                res.on( 'data', function ( chunk ) {
                  var data = JSON.parse( chunk ),
                      translation;

                  if( data.error ) {
                    return reject(
                      new Error( 'google-translate request failed' +
                                 '( ' + JSON.stringify( data.error ) + ')' )
                    );
                  }

                  translation = data.data.translations[ 0 ].translatedText;
                  resolve( translation );
                });
              };

              https.get( url, parseTranslation );
            });
      };

  return new Promise(function( resolve, reject ) {
    var rl = readline
              .createInterface(
                fs.createReadStream( getTargetFilePathByFile( fileName ) ),
                new Stream
              ),
        prevId;

    rl.on( 'line', function( line ) {
      /* Minimal Regexes */
      var id = /xml:id="sub([0-9]+)"/gi,
          begin = /begin="1([0-9]+):([0-9\:]+)\.([0-9\:]+)"/gi,
          end = /end="1([0-9]+):([0-9\:]+)\.([0-9\:]+)"/gi,
          text = /<tt:span.+>(.*)<\/tt:span>/gi;

      var matchId = id.exec( line ),
          matchBegin,
          matchEnd,
          matchText;

      if( matchId ) {
        ast[ matchId[ 1 ] ] = {};
        prevId = matchId[ 1 ];
      }

      matchBegin = begin.exec( line );
      matchEnd = end.exec( line );

      if( matchBegin ) {
        ast[ prevId ].begin = '0' + matchBegin[ 1 ] + ':' +
                              matchBegin[ 2 ] + ',' +
                              matchBegin[ 3 ];
      }

      if( matchEnd ) {
        ast[ prevId ].end = '0' + matchEnd[ 1 ] + ':' +
                            matchEnd[ 2 ] + ',' +
                            matchEnd[ 3 ];
      }

      if( matchBegin || matchEnd ) {
        return;
      }

      matchText = text.exec( line );

      if( matchText ) {
        if( !ast[ prevId ].text ) {
          ast[ prevId ].text = matchText[ 1 ];
        } else {
          ast[ prevId ].text += ' ' + matchText[ 1 ];
        }
      }
    } );

    rl.on( 'close', function() {
      readCache( targetLang )
        .then( function( cache ) {
          if( targetLang === 'de' ) {
            return ast;
          }

          return translateAST( ast, cache );
        })
        .then( generateSRT )
        .then( function( ast ) {
          return writeCache( ast, targetLang );
        } )
        .then( resolve )
        .catch( reject );
    } );
  });
};

module.exports = new Translator();
