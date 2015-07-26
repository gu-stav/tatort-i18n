var async = require(  'async'  ),
    colors = require( 'colors' ),
    config = require( '../config.json' ),
    fs = require( 'fs'),
    he = require( 'he' ),
    http = require( 'follow-redirects' ).http,
    https = require( 'https' ),
    libxmljs = require( 'libxmljs' ),
    path = require( 'path' )
    Promise = require( 'bluebird' ),
    readline = require( 'readline' ),
    Stream = require( 'stream' );

var translator = {},
    generateFileNameByUrl = function( url, extension ) {
      var fileName,

      fileName = /videos\/(.*)-video-[\w\d\-]+\.html$/gi.exec( url );

      if( !fileName || !fileName[ 1 ] ) {
        throw new Error( 'Either the URL Format has changed, or the ' +
                         'URL is invalid. Make sure you copied the ' +
                         'the page, where the Video can be ' +
                         'played ... (URL: ' + url + ')' );
      }

      return fileName[ 1 ] + '.' + extension;
    },

    getTargetFilePathByUrl = function( url ) {
      return __dirname + '/../subtitles/' +
            generateFileNameByUrl( url, 'ttml' );
    },

    getTargetFilePathByFile = function( fileName ) {
      return __dirname + '/../subtitles/' + fileName;
    },

    getCacheFile = function( targetLang ) {
      return __dirname + '/../tatort-cache/' + targetLang + '.json'
    },

    getVideoDirectory = function() {
      return __dirname + '/../video/';
    },

    getVideoFilePathByUrl = function( url ) {
      return getVideoDirectory() + generateFileNameByUrl( url, 'mp4' );
    };

translator.downloadVideo = function( url ) {
  var videoAlreadyExists = function() {
        var filePath = getVideoFilePathByUrl( url );

        return new Promise( function( resolve, reject ) {
          fs.exists( filePath, function( err, exists ) {
            if( err ) {
              return reject( err );
            }

            resolve( exists );
          });
        } );
      },

      getVideoUrl = function( url ) {
        var generatePlayerConfigUrl = function( url ) {
              return url.replace( '100.html', '100~playerXml.xml' );
            };

        var fileName = generateFileNameByUrl( url, 'mp4' ),
            playerUrl = generatePlayerConfigUrl( url ),
            videoPrefix = 'http://mvideos.daserste.de/',
            data = '',
            videoUrl,
            xml,
            downloadChild;

        return new Promise( function( resolve, reject ) {
          http
            .get( playerUrl, function( res ) {
              res.setEncoding( 'utf8' );

              res.on( 'data', function( chunk ) {
                data += chunk.toString();
              });

              res.on( 'end', function( chunk ) {
                xml = libxmljs.parseXml( data );
                downloadChild = xml.get( '//asset[contains(@type,"Web M VOD")]/fileName' );
                videoUrl = downloadChild.text().replace('mp4:', '');
                videoUrl = videoPrefix + videoUrl;

                resolve( [ videoPrefix + videoUrl, url ] );
              });
            } )
            .on( 'error', reject );
        });
      },

      downloadVideo = function( videoUrl, url ) {
        var fileStream = fs.createWriteStream( getVideoFilePathByUrl( url, 'mp4' ) );

        return new Promise( function( resolve, reject ) {
          http
            .get( videoUrl, function( res ) {
              res.on( 'data', function( chunk ) {
                fileStream.write( chunk );
              });

              res.on( 'end', function() {
                fileStream.end();
                resolve( getVideoFilePathByUrl( url ) );
              });
            })
            .on( 'error', reject );
        });
      };

  return videoAlreadyExists( url )
    .then( function( exists ) {
      if( exists ) {
        return getVideoFilePathByUrl( url );
      }

      return getVideoUrl( url )
        .spread( downloadVideo );
    } );
};

translator.downloadSubtitle = function( url ) {
  var downloadFile = function( url ) {
        var subtitleUrl = url.replace( '100.html', 'ut100.xml' ),
            data = '';

        return new Promise(function( resolve, reject ) {
          http
            .get( subtitleUrl, function( res ) {
              res.setEncoding( 'utf8' );

              if( res.statusCode !== 200 ) {
                return reject( new Error( 'URL has no subtitles' ) );
              }

              res.on( 'data', function( chunk ) {
                data += chunk;
              });

              res.on( 'end', function() {
                fs.writeFile( getTargetFilePathByUrl( url ), data, function() {
                  resolve( generateFileNameByUrl( url, 'ttml' ) );
                });
              });
            } )
            .on( 'error', reject );
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
          return generateFileNameByUrl( url, 'ttml' );
        }
      });
};

translator.translate = function( fileName, targetLang ) {
  var generateSRT = function( ast ) {
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

      writeResult = function( data, type ) {
        var sourcePath = getTargetFilePathByFile( fileName ),
            targetFilename = path.basename( sourcePath,
                                            path.extname( sourcePath ) ) +
                                            '-' + targetLang + '.' + type,
            targetPath = path.join( path.dirname( sourcePath ), targetFilename );

        return new Promise(function( resolve, reject ) {
          fs.writeFile( targetPath, data, function( err ) {
            if( err ) {
              return reject( err );
            }

            resolve();
          });
        });
      },

      readCache = function( targetLang ) {
        return new Promise(function( resolve, reject ) {
          fs.exists( getCacheFile( targetLang ), function( exists ) {
            if( !exists ) {
              return resolve( {} );
            }

            fs.readFile( getCacheFile( targetLang ), function( err, data ) {
              try {
                resolve( JSON.parse( data ) );
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
                  data[ ast[ i ].text ] = ast[ i ].translation || ast[ i ].text;
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
                .then( writeToFile );
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

          async.forEachOfLimit( ast, 25, doTranslation, function( err ) {
            if( err ) {
              return reject( err );
            }

            resolve( ast );
          });
        });
      },

      /* Translate a single string */
      translate = function( text ) {
        if( !config[ 'translate-api-key' ] ) {
          return reject( new Error( 'No API Key provided (config.json).' ) );
        }

        var url = 'https://www.googleapis.com/' +
                  'language/translate/v2' +
                  '?target=' + targetLang +
                  '&source=de' +
                  '&key=' + config[ 'translate-api-key' ] +
                  '&q=' + encodeURIComponent( text ),
            data = '',
            validResCodes = [
              200,
              304,
            ];

        return new Promise(function( resolve, reject ) {
          https
            .get( url, function( res ) {
              res.setEncoding( 'utf8' );

              if( validResCodes.indexOf( res.statusCode ) === -1 ) {
                return reject( new Error( 'Status Code not in valid range.' +
                                          'Code: ' + res.statusCode +
                                          'Allowed: ' +
                                          validResCodes.join( ', ')
                               ) );
              }

              res.on( 'data', function( chunk ) {
                data += chunk.toString();
              });

              res.on( 'end', function ( chunk ) {
                try {
                  data = JSON.parse( data );
                } catch( err ) {
                  return reject( err );
                }

                if( data.error ) {
                  return reject(
                    new Error( 'google-translate request failed' +
                               '( ' + JSON.stringify( data.error ) + ')' )
                  );
                }

                resolve( data.data.translations[ 0 ].translatedText );
              });
            } )
            .on( 'error', reject );
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
