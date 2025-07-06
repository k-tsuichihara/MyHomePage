
/*--------------------------------------------------------------
	
	Script Name : SP Menu
	Author      : FIRSTSTEP - Motohiro Tani
	Author URL  : https://www.1-firststep.com
	Create Date : 2018/07/05
	Version     : 2.0
	Last Update : 2019/04/11
	
--------------------------------------------------------------*/


(function( $ ) {
	
	// function sp_open_close
	function sp_open_close() {
		
		if ( $( this ).hasClass( 'sp-close' ) ) {
			
			$( this )
				.removeClass( 'sp-close' )
				.addClass( 'sp-open' );
			
			$( '#menu' ).slideDown( 'fast' );
			
		} else {
			
			$( this )
				.removeClass( 'sp-open' )
				.addClass( 'sp-close' );
			
			$( '#menu' ).slideUp( 'fast' );
			
		}
		
	}
	
	
	
	
	$( '#sp-icon' ).on( 'click', sp_open_close );
	
})( jQuery );