(function (global, factory) {
	typeof module === 'object' && module.exports ? module.exports = factory(require('babel-polyfill'), require('other')) :
	typeof define === 'function' && define.amd ? define(['babel-polyfill', 'other'], factory) :
	(global.myBundle = factory(null,global.other));
}(this, (function (babelPolyfill,other) { 'use strict';

	other.x();

	var main = new WeakMap();

	return main;

})));
