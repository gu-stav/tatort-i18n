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
    cli = require( 'commander' );

cli
  .version( '0.0.1' )
  .parse( process.argv );

var concurrentConnections = 10,
    sourceLang = 'de',
    targetLang = 'en',
    TRANSLATE_API_KEY = 'AIzaSyCzK4Zi2w-ERWH2O4uGMrchoqiqEXBTAW8',
    sourcePath = cli.args[ 0 ],
    targetFilename = path.basename( sourcePath, path.extname( sourcePath ) ) +
                     '-' + targetLang + '.srt',
    targetPath = path.dirname( sourcePath ),
    ast = {};

var /* Generate and write the .srt File, which is generated from the AST */
    generateSRT = function( ast ) {
      var string = '';

      for( var i in ast ) {
        string += '\n';
        string += i + '\n';
        string += ast[ i ].begin + ' --> ' + ast[ i ].end + '\n';
        string += ast[ i ].translation + '\n';
      }

      fs.writeFile( path.dirname( sourcePath ) + '/' + targetFilename, string );
    },

    /* Translate the whole AST */
    translateAST = function( ast, cb ) {
      var doTranslation = function( value, key, callback ) {
        translate( value.text, function( translation ) {
          ast[ key ].translation = translation;
          callback( null );
        });
      };

      async
        .forEachOfLimit( ast,
                         concurrentConnections,
                         doTranslation, function() {
          cb( ast );
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

              console.log( colors.white( text ) +
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
      translateAST( ast, function( ast ) {
        generateSRT( ast );
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
