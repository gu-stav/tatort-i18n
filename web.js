var _ = require( 'lodash' ),
    bodyParser = require( 'body-parser' ),
    express = require( 'express' ),
    fs = require( 'fs' ),
    path = require( 'path' ),
    Promise = require( 'bluebird' ),
    translator = require( './lib/translator' );

var app = express();

app.use( '/subtitles', express.static( './subtitles' ) );
app.use( '/videos', express.static( './videos' ) );

app.set( 'view engine', 'jade' );
app.set( 'views', './web/views' );
app.use( bodyParser.urlencoded( { extended: true } ) );

app.post( '/generate', function ( req, res ) {
  var data = {},
      reqData = req.body,
      url = reqData.url,
      targetLang = reqData.targetlang,
      allowedLanguages = [ 'de', 'en', 'fr', ];

  if( !url.length || allowedLanguages.indexOf( targetLang ) === -1 ) {
    return res.redirect( '/' );
  }

  translator
    .downloadSubtitle( url )
    .then( function( fileName ) {
      return translator.translate( fileName, targetLang );
    } )
    .then(function() {
      res.redirect( '/' );
    })
    .catch(function( err ) {
      res.status( 500 ).send( '<h1>Ooops, an error occurred. Sorry for that!' +
                              '</h1>' +
                              '<strong>Please send me the complete error message, ' +
                              'to improve the tool: ' +
                              '<a href="mailto:pursche@posteo.de">' +
                              'pursche@posteo.de</a>' +
                              ' or fix it by yourself on github:</strong> ' +
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
          fs.readdir( __dirname + '/videos', function( err, files ) {
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
