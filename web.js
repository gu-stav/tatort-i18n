var express = require( 'express' ),
    bodyParser = require( 'body-parser' ),
    fs = require( 'fs' ),
    _ = require( 'lodash' ),
    translator = require( './lib/translator' ),
    path = require( 'path' );

var app = express();

app.use( '/subtitles', express.static( './subtitles' ) );
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
    .download( url )
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
                              'pursche@posteo.de</a></strong>' +
                              '<pre>' + err.stack.toString() + '</pre>' );
    });
});

app.get( '/', function ( req, res ) {
  var data = {
    translations: [],
  };

  fs.readdir( __dirname + '/subtitles', function( err, files ) {
    data.translations = _.filter( files , function( file ) {
      return /\.srt/gi.test( file );
    });

    res.render( 'index', data );
  });
});

var server = app.listen( 3000 );