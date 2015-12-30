var uglify = require( 'uglify-js' );
var MagicString = require( 'magic-string' );
var assert = require( 'assert' );
var getLocation = require( '../../utils/getLocation' );
var SourceMapConsumer = require( 'source-map' ).SourceMapConsumer;

module.exports = {
	description: 'preserves sourcemap chains when transforming',
	options: {
		plugins: [
			{
				transformBundle: function ( code, map ) {
					var options = { fromString: true };

					if ( map != null ) {
						options.inSourceMap = map;
						options.outSourceMap = "out";
					}

					var result = uglify.minify( code, options );

					if ( map != null ) {
						result.code = result.code.slice( 0, -25 );
					}

					return result;
				}
			}
		]
	},
	test: function ( code, map ) {
		var smc = new SourceMapConsumer( map );

		var generatedLoc = getLocation( code, code.indexOf( '42' ) );
		var originalLoc = smc.originalPositionFor( generatedLoc );

		assert.ok( /main/.test( originalLoc.source ) );
		assert.equal( originalLoc.line, 1 );
		assert.equal( originalLoc.column, 13 );

		generatedLoc = getLocation( code, code.indexOf( 'log' ) );
		originalLoc = smc.originalPositionFor( generatedLoc );

		assert.equal( originalLoc.line, 1 );
		assert.equal( originalLoc.column, 8 );
	}
};