(function (global, factory) {
	typeof module === 'object' && module.exports ? factory() :
	typeof define === 'function' && define.amd ? define(factory) :
	(factory());
}(this, (function () { 'use strict';

	var effect1 = () => console.log( 'effect' );
	var associated = () => {};
	for ( var associated = effect1; true; ) {
		break;
	}
	associated();

	var effect3 = () => console.log( 'effect' ); // Must not be removed!
	for ( let foo = effect3; true; ) {
		foo(); // Must not be removed!
		break;
	}

})));
