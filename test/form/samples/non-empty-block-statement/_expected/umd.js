(function (global, factory) {
	typeof module === 'object' && module.exports ? factory() :
	typeof define === 'function' && define.amd ? define(factory) :
	(factory());
}(this, (function () { 'use strict';

	console.log( 1 );
	{
		var tmp = 10;
	}
	console.log( tmp );

})));
