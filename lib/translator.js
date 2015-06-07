var async = require(  'async'  ),
    colors = require( 'colors' ),
    fs = require( 'fs'),
    he = require( 'he' ),
    http = require( 'http' ),
    https = require( 'https' ),
    path = require( 'path' )
    Promise = require( 'bluebird' ),
    readline = require( 'readline' ),
    Stream = require( 'stream' );

var translator = {},
    generateFileNameByUrl = function( url ) {
      var fileName,
          pattern = /\/videos\/([a-z\-0-9]+)/gi;

      fileName = pattern.exec( url );

      if( !fileName || !fileName[ 1 ] ) {
        throw new Error( 'Either the URL Format has changed, or you ' +
                         'put an invalid URL. Make sure you pasted the ' +
                         'page, where the Video can be actually played ... ' +
                         '(URL: ' + url + ')' );
      }

      /* just to make the filename a bit nicer to read */
      return fileName[ 1 ].replace( '-video-tgl-ab-20-uhr-100', '' ) + '.ttml';
    },

    getTargetFilePathByUrl = function( url ) {
      return __dirname + '/../subtitles/' + generateFileNameByUrl( url );
    },

    getTargetFilePathByFile = function( fileName ) {
      return __dirname + '/../subtitles/' + fileName;
    },

    getCacheFile = function( targetLang ) {
      return __dirname + '/../tatort-cache/' + targetLang + '.json'
    };

translator.downloadSubtitle = function( url ) {
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
          /* simply return the filename */
          return generateFileNameByUrl( url );
        }
      });
};

translator.translate = function( fileName, targetLang ) {
  /* Number of requests, run in parallel to the translate API */
  var CONCURRENT_CONNECTIONS = 25,
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

        /* Replaces HTMl Special Characters, which are not ASCII */
        data = he.decode( data );

        return writeResult( data, 'srt' )
                .then(function() {
                  return ast;
                });
      },

      writeResult = function( data, type, ast ) {
        var sourcePath = getTargetFilePathByFile( fileName ),
            targetFilename = path.basename( sourcePath,
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
        var data = {};

        return new Promise(function( resolve, reject ) {
          fs.exists( getCacheFile( targetLang ), function( exists ) {
            if( !exists ) {
              return resolve( data );
            }

            fs.readFile( getCacheFile( targetLang ), function( err, data ) {
              try {
                data = JSON.parse( data );
                resolve( data );
              } catch( err ) {
                reject( err );
              }
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
                /* file was already completly in the language cachefile */
                if( !hasChanges ) {
                  return resolve();
                }

                fs.writeFile( getCacheFile( targetLang ),
                              JSON.stringify( data ),
                              function( err ) {
                                if( err ) {
                                  return reject( err );
                                }

                                resolve();
                              } );
              });
            };

        return readCache( targetLang )
                .then( writeToFile )
                .then( resolve() )
                .then( reject );
      },

      /* Translate the whole AST */
      translateAST = function( ast, cache ) {
        return new Promise(function( resolve, reject ) {
          var doTranslation = function( value, key, callback ) {

            /* Cache hit */
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
                             CONCURRENT_CONNECTIONS,
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
        /* TODO: Move key out of the code, to it's own file, or make it
                 part of the API */
        var API_KEY = 'AIzaSyCzK4Zi2w-ERWH2O4uGMrchoqiqEXBTAW8',
            url = 'https://www.googleapis.com/' +
                  'language/translate/v2' +
                  '?target=' + targetLang +
                  '&source=de' +
                  '&key=' + API_KEY +
                  '&q=' + encodeURIComponent( text );

            return new Promise(function( resolve, reject ) {
              var parseTranslation = function( res ) {
                res.setEncoding( 'utf8' );

                res.on( 'data', function ( chunk ) {
                  var data = chunk.toString();

                  /* sometimes the API returns an HTML document, instead of
                      jsonable data */
                  try {
                    data = JSON.parse( data );
                  } catch( err ) {
                    return reject( err );
                  }

                  if( data.error || res.statusCode !== 200 ) {
                    return reject(
                      new Error( 'google-translate request failed' +
                                 '( ' + JSON.stringify( data.error ) + ')' )
                    );
                  }

                  resolve( data.data.translations[ 0 ].translatedText );
                });
              };

              /* perform the request */
              https.get( url, parseTranslation );
            });
      },

      translateFile = function( fileName, targetLang ) {
        var rl = readline
                  .createInterface(
                    fs.createReadStream( getTargetFilePathByFile( fileName ) ),
                    new Stream
                  ),
            ast = {},
            prevId;

        return new Promise(function( resolve, reject ) {
          var parseSingleLine = function( line ) {
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
                    /* TODO: Try to respect linebreaks */
                    ast[ prevId ].text += ' ' + matchText[ 1 ];
                  }
                }
              },

              generateFiles = function() {
                readCache( targetLang )
                  .then( function( cache ) {
                    /* No need to translate german */
                    if( targetLang === 'de' ) {
                      return ast;
                    }

                    return translateAST( ast, cache );
                  })
                  .then( generateSRT )
                  .then( function( ast ) {
                    /* No need to generate a german cache */
                    if( targetLang === 'de' ) {
                      return;
                    }

                    return writeCache( ast, targetLang );
                  } )
                  .then( resolve )
                  .catch( reject );
              };

          rl.on( 'line', parseSingleLine );
          rl.on( 'close', generateFiles );
        });
      };

      return translateFile( fileName, targetLang );
};

module.exports = translator;
