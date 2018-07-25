
'use strict';

var validator = require('validator'),
    moment    = require('moment'),
    LeaveRequestParameters = require('../../model/leave_request_parameters');

module.exports = function(args){
    var req = args.req;

    var user           = validator.trim( req.param('user') ),
        leave_type     = validator.trim( req.param('leave_type') ),
        from_date      = validator.trim( req.param('from_date') ),
        from_date_part = validator.trim( req.param('from_date_part') ),
        to_date        = validator.trim( req.param('to_date') ),
        to_date_part   = validator.trim( req.param('to_date_part') ),
        reason         = validator.trim( req.param('reason') );

    if (user && !validator.isNumeric(user)){
        req.session.flash_error('Karyawan salah');
    }

    if (!validator.isNumeric(leave_type)){
        req.session.flash_error('Tipe cuti salah');
    }

    var date_validator = function(date_str, label) {
      try {

        // Basic check
        if (! date_str ) throw new Error("Tanggal harus diisi");

        date_str = req.user.company.normalise_date(date_str);

        // Ensure that normalisation went OK
        if (! validator.isDate(date_str)) throw new Error("Format tanggal tidak salah");

      } catch (e) {
        console.log('Got an error ' + e);
        req.session.flash_error(label + ' harus berupa tanggal');
      }
    }

    date_validator(from_date, 'From date');

    if (  !validator.matches(from_date_part, /^[123]$/)
       || !validator.matches(to_date_part, /^[123]$/)
     ){
        req.session.flash_error('Bagian hari tidak valid');
    }

    date_validator(to_date, 'To date');

    // Check if it makes sence to continue validation (as following code relies on
    // to and from dates to be valid ones)
    if ( req.session.flash_has_errors() ) {
      throw new Error( 'Terdapat kesalahan validasi' );
    }

    // Convert dates inot format used internally
    from_date = req.user.company.normalise_date(from_date);
    to_date = req.user.company.normalise_date(to_date);

    if (from_date.substr(0,4) !== to_date.substr(0,4)) {
        req.session.flash_error('Implementasi saat ini tidak memungkinkan cuti antartahun. Silakan pecah permohonan menjadi dua bagian');
    }

    if ( req.session.flash_has_errors() ) {
      throw new Error( 'Terdapat kesalahan validasi' );
    }

    var valid_attributes = {
        leave_type     : leave_type,
        from_date      : from_date,
        from_date_part : from_date_part,
        to_date        : to_date,
        to_date_part   : to_date_part,
        reason         : reason,
    };

    if ( user ) {
        valid_attributes.user = user;
    }

    return new LeaveRequestParameters( valid_attributes );
};
