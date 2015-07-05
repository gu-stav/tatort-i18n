var _ = require( 'lodash' ),
    bodyParser = require( 'body-parser' ),
    express = require( 'express' ),
    fs = require( 'fs' ),
    Promise = require( 'bluebird' ),
    translator = require( './lib/translator' );

var app = express();

app.use( '/subtitles', express.static( './subtitles' ) );
app.use( '/video', express.static( './video' ) );

app.set( 'view engine', 'jade' );
app.set( 'views', './web/views' );
app.use( bodyParser.urlencoded( { extended: true } ) );

app.post( '/generate', function ( req, res ) {
  var reqData = req.body,
      url = reqData.url,
      targetLang = reqData.targetlang,
      allowedLanguages = [ 'de', 'en', 'fr', ];

  if( !url.length || allowedLanguages.indexOf( targetLang ) === -1 ) {
    return res.status( 500 ).send( 'Either the wrong URL or you try to ' +
                                   'cheat. If you need another language, ' +
                                   'feel free to contact me: ' +
                                   'pursche@posteo.de.<br/>' +
                                   'The following languages are currently ' +
                                   'allowed: ' +
                                    allowedLanguages.join( ', ' ) );
  }

  /* don't wait for finishing this task - just do in the background */
  translator
    .downloadVideo( url )
    .catch(function( err ) {
      console.error( err );
    });

  translator
    .downloadSubtitle( url )
    .then( function( fileName ) {
      return translator.translate( fileName, targetLang );
    } )
    .then(function() {
      res.redirect( 'back' );
    })
    .catch(function( err ) {
      console.error( err );

      res.status( 500 ).send( '<h1>Ooops, an error occurred. Sorry for that!' +
                              '</h1>' +
                              '<strong>Please send me the complete error message, ' +
                              'to improve the tool: ' +
                              '<a href="mailto:pursche@posteo.de">' +
                              'pursche@posteo.de</a> ' +
                              'or fix it by yourself:</strong> ' +
                              'https://github.com/gustavpursche/tatort-i18n' +
                              '<pre>' + err.stack.toString() + '</pre>' );
    });
});

app.get( '/', function ( req, res ) {
  var data = {},
      friendMode = req.query && req.query.friend;

  var listSubtitles = function() {
        var subtitles = [];

        return new Promise(function( resolve, reject ) {
          fs.readdir( __dirname + '/subtitles', function( err, files ) {
            if( err ) {
              return reject( err );
            }

            subtitles = _.filter( files , function( file ) {
              return /\.srt/gi.test( file );
            });

            resolve( subtitles );
          });
        });
      },
      listVideos = function() {
        var videos = [];

        return new Promise(function( resolve, reject ) {
          fs.readdir( __dirname + '/video', function( err, files ) {
            if( err ) {
              return reject( err );
            }

            videos = _.filter( files , function( file ) {
              return /\.mp4/gi.test( file );
            });

            resolve( videos );
          });
        });
      };

  listSubtitles()
    .then(function( translations ) {
      data.translations = translations;

      if( !friendMode ) {
        return res.render( 'index', data );
      }

      return listVideos()
              .then(function( videos ) {
                data.videos = videos;
                return res.render( 'index', data );
              });
    });
});

app.listen( 3000 );
