(function (global, factory) {
	typeof module === 'object' && module.exports ? factory(exports, require('x')) :
	typeof define === 'function' && define.amd ? define(['exports', 'x'], factory) :
	(factory((global.myBundle = {}),global.x));
}(this, (function (exports,x) { 'use strict';

	x = x && x.hasOwnProperty('default') ? x['default'] : x;



	exports.x = x;

	Object.defineProperty(exports, '__esModule', { value: true });

})));
