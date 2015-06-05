/*

Generate a SRT Subtitle file from the (special) Tatort TTML-Files

*/

var fs = require( 'fs' ),
    readline = require( 'readline' ),
    Stream = require( 'stream' ),
    https = require( 'https' ),
    async = require(  'async'  ),
    colors = require( 'colors' ),
    path = require( 'path' ),
    cli = require( 'commander' ),
    Promise = require( 'bluebird' );

cli
  .version( '0.0.1' )
  .parse( process.argv );

var concurrentConnections = 10,
    sourceLang = 'de',
    targetLang = 'en',
    TRANSLATE_API_KEY = 'AIzaSyCzK4Zi2w-ERWH2O4uGMrchoqiqEXBTAW8',
    sourcePath = cli.args[ 0 ],
    targetPath = path.dirname( sourcePath ),
    ast = {};

var /* Generate and write the .srt File, which is generated from the AST */
    generateSRT = function( ast ) {
      var data = '';

      for( var i in ast ) {
        data += '\n';
        data += i + '\n';
        data += ast[ i ].begin + ' --> ' + ast[ i ].end + '\n';
        data += ast[ i ].translation + '\n';
      }

      /* Replaces ASCII Encoded Characters */
      data = data.replace( /&#(\d+);/g,
                      function ( m, n ) {
                        return String.fromCharCode( n );
                      });

      writeResult( data, 'srt' );
    },

    writeResult = function( data, type ) {
      var targetFilename = path.basename( sourcePath,
                                          path.extname( sourcePath ) ) +
                                          '-' + targetLang + '.' + type;

      fs.writeFile( path.dirname( sourcePath ) + '/' + targetFilename, data );
    },

    readCache = function( targetLang ) {
      return new Promise(function( resolve, reject ) {
        var cacheFile = path.dirname( sourcePath ) +
                        '/tatort-cache/' +
                        targetLang +
                        '.json',
            data = {};

        fs.exists( cacheFile, function( exists ) {
          if( !exists ) {
            return resolve( data );
          }

          fs.readFile( cacheFile, function( err, data ) {
            resolve( JSON.parse( data ) )
          });
        });
      });
    },

    /* generates cache file for a certain language */
    writeCache = function( ast, targetLang ) {
      var cacheFile = path.dirname( sourcePath ) +
                      '/tatort-cache/' +
                      targetLang +
                      '.json',
          writeToFile = function( data ) {
            var hasChanges = false;

            if( !data ) {
              data = {};
            }

            for( var i in ast ) {
              if( !data[ ast[ i ].text ] ) {
                data[ ast[ i ].text ] = ast[ i ].translation;
                hasChanges = true;
              }
            }

            if( hasChanges ) {
              fs.writeFile( cacheFile, JSON.stringify( data ) );
            }
          };

      fs.exists( cacheFile, function( exists ) {
        if( !exists ) {
          fs.readFile( cacheFile, function( err, data ) {
            writeToFile( data );
          });
        } else {
          writeToFile();
        }
      });
    },

    /* Translate the whole AST */
    translateAST = function( ast, cache ) {
      return new Promise(function( resolve, reject ) {
        var doTranslation = function( value, key, callback ) {

          if( cache && cache[ value.text ] ) {
            ast[ key ].translation = cache[ value.text ];

            console.log( colors.green( '[cache] ' ) +
                         colors.white( value.text ) +
                         ' --> ' +
                         colors.green( cache[ value.text ] ) );

            return callback( null );
          }

          translate( value.text, function( translation ) {
            ast[ key ].translation = translation;
            callback( null );
          });
        };

        async
          .forEachOfLimit( ast,
                           concurrentConnections,
                           doTranslation, function() {
            resolve( ast );
          });
      });
    },

    /* Translate a single string */
    translate = function( text, callback ) {
      var req_options = {
            host: 'www.googleapis.com',
            path: encodeURI( '/language/translate/v2' +
                             '?target=' + targetLang +
                             '&source=' + sourceLang +
                             '&key=' + TRANSLATE_API_KEY +
                             '&q=' + text ),
            method: 'GET',
            PORT: '443',
          },

          parseTranslation = function( res ) {
            res.setEncoding( 'utf8' );

            res.on( 'data', function ( chunk ) {
              var raw = chunk.toString(),
                  data = JSON.parse(raw),
                  translation = data.data
                                  .translations[ 0 ].translatedText;

              if( !translation ) {
                return callback( new Error( 'Could not translate' ) );
              }

              console.log( colors.red( '[req] ' ) +
                           colors.white( text ) +
                           ' --> ' +
                           colors.green( translation ) );

              callback( translation );
            });
          };

          https.request( req_options, parseTranslation ).end();
    },

    /* parse a single line of the input .xml */
    parseLine = function( line ) {
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
    },

    /* after reading the initial file and generating the AST, translate the
       whole thing and generate the .srt */
    translateAndGenerate = function() {
      readCache( targetLang )
        .then( function( cache ) {
          return translateAST( ast, cache );
        })
        .then( function( ast ) {
          generateSRT( ast );
          writeCache( ast, targetLang );
        } );
    },

    /* start doing something */
    init = function() {
      var rl = readline.createInterface( fs.createReadStream( sourcePath ),
                                         new Stream ),
          prevId;

      rl.on( 'line', parseLine );
      rl.on( 'close', translateAndGenerate );
    };

init();
