
/*
 *  Contain handlers for dealing with user account:
 *      - login
 *      - logout
 *      - register
 *      - forget password
 *
 *  Module exports FUNCTION that create a router object,
 *  not the router itself!
 *  Exported function gets passport object.
 * */
'use strict';

var
  validator      = require('validator'),
  Promise        = require('bluebird'),
  formidable     = require('formidable'),
  fs             = require("fs"),
  config         = require('../config'),
  moment_tz      = require('moment-timezone'),
  EmailTransport = require('../email');

Promise.promisifyAll(fs);

var get_url_to_site_root_for_anonymous_session = function(req) {
  return req.get('host').indexOf('app.timeoff') < 0
    ? '/'
    : config.get('promotion_website_domain');
}

module.exports = function(passport) {

  var express = require('express');
  var router  = express.Router();

  router.get('/login', function(req, res){
      res.render('login', {
          allow_create_new_accounts: JSON.parse(config.get('allow_create_new_accounts')),
          title : 'Time Off Management',
          url_to_the_site_root : get_url_to_site_root_for_anonymous_session(req),
      });
  });

  router.post('/login', function(req, res, next) {
    passport.authenticate('local', function(err, user, info) {
      if (err) { return next(err); }

      if (!user) {
        req.session.flash_error('Incorrect credentials');
        return res.redirect_with_session('/login');
      }

      req.logIn(user, function(err) {
        if (err) { return next(err); }

        req.session.flash_message('Welcome back '+user.name+'!');

        return res.redirect_with_session('/');
      });
    })(req, res, next);
  });

  router.get('/logout', function(req, res){

      // Maybe this check is redundant but to be on safe side lets do it
      if ( !req.user ) {
          return res.redirect_with_session(303, '/');
      }

      req.logout();

      return res.redirect_with_session(res.locals.url_to_the_site_root);
  });

  router.get('/register', function(req, res){

      // Disable new accounts.
      if ( !JSON.parse(config.get('allow_create_new_accounts')) ) {
        return res.redirect_with_session(res.locals.url_to_the_site_root);
      }

      // There is no need to register new accounts when user alreeady login
      if ( req.user ) {
        return res.redirect_with_session(303, '/');
      }

      res.render('register',{
        url_to_the_site_root : get_url_to_site_root_for_anonymous_session(req),
        countries            : config.get('countries'),
        timezones_available  : moment_tz.tz.names(),
      });
  });

  router.post('/register', function(req, res){

      // There is no need to register new accounts when user alreeady login
      // (just to prevent people to mess around)
      if ( req.user ) {
        return res.redirect_with_session(303, '/');
      }

      // TODO at some point we need to unified form validation code
      // and make it reusable

      var email_validation_re = /^([\w-]+(?:\.[\w-]+)*)@((?:[\w-]+\.)*\w[\w-]{0,66})\.([a-z]{2,6}(?:\.[a-z]{2})?)$/i;

      var email = req.param('email');
      if (!email){
          req.session.flash_error('Surel tidak diisi');
      } else if ( ! email_validation_re.test( email )) {
          req.session.flash_error('Surel tidak valid');
      }

      var name = req.param('name');
      if (!name){
          req.session.flash_error('Nama tidak diisi');
      }

      var lastname = req.param('lastname');
      if (!lastname) {
          req.session.flash_error('Nama akhir tidak diisi');
      }

      var company_name = req.param('company_name');

      var password = req.param('password');
      if (!password) {
          req.session.flash_error('Kata sandi tidak boleh kosong');
      } else if ( password !== req.param('password_confirmed') ) {
          req.session.flash_error('Konfirmasi kata sandi tidak sama dengan kata sandi awal');
      }

      var country_code = req.param('country');
      if (! validator.matches(country_code, /^[a-z]{2}/i) ){
          req.session.flash_error('Kode negara tidak valid');
      }

      let timezone = validator.trim(req.param('timezone'));
      if ( ! moment_tz.tz.names().find(tz_str => tz_str === timezone) ) {
        req.session.flash_error('Zona waktu tidak diketahui');
      }

      // In case of validation error redirect back to registration form
      if ( req.session.flash_has_errors() ) {
          return res.redirect_with_session('/register/');
      }

      // Try to create new record of user
      req.app.get('db_model').User.register_new_admin_user({
          email        : email.toLowerCase(),
          password     : password,
          name         : name,
          lastname     : lastname,
          company_name : company_name,
          country_code : country_code,
          timezone     : timezone,
      })
      // Send registration email
      .then(function(user){
        var email = new EmailTransport();

        return email.promise_registration_email({
          user : user,
        })
        .then(function(){
          return Promise.resolve(user)
        });
      })
      .then(function(user){

        // Login newly created user
        req.logIn(user, function(err) {
          if (err) { return next(err); }

          req.session.flash_message(
              'Registrasi selesai.'
          );

          return res.redirect_with_session('/');
        });

      })
      .catch(function(error){
          console.error(
              'An error occurred when trying to register new user '
                  + email + ' : ' + error
          );

          req.session.flash_error(
            'Gagal mendaftarkan pengguna, silakan hubungi layanan pelanggan.'+
              (error.show_to_user ? ' '+ error : '')
          );

          return res.redirect_with_session('/register/');
      });

  });

  router.get('/forgot-password/', function(req, res){

    res.render('forgot_password',{
      url_to_the_site_root : get_url_to_site_root_for_anonymous_session(req),
    });
  });

  router.post('/forgot-password/', function(req, res){
    var email = req.param('email');

    if (!email){
      req.session.flash_error('Surel tidak diisi');

    } else if ( ! validator.isEmail(email)) {
      req.session.flash_error('Surel tidak valid');
    }

    // In case of validation error redirect back to forgot password form
    if ( req.session.flash_has_errors() ) {
      return res.redirect_with_session('./');
    }

    var success_msg ='Silakan cek kotak surel untuk instruksi berikutnya';

    // Normalize email address: system operates only in low cased emails
    email = email.toLowerCase();

    req.app.get('db_model').User.find_by_email(email)
      .then(function(user){

        if (!user) {
          req.session.flash_message(success_msg);

          var error = new Error('');
          error.do_not_report = true;
          throw error;
        }

        return Promise.resolve(user);
      })
      .then(function(user){
        var Email = new EmailTransport();

        return Email.promise_forgot_password_email({
          user : user,
        });
      })
      .then(function(){
          req.session.flash_message(success_msg);
          return res.redirect_with_session('./');
      })
      .catch(function(error){

        if (error.do_not_report ){
          return res.redirect_with_session('./');
        }

        console.error('An error occurred while submittin forgot password form: '+error);
        req.session.flash_error('Gagal untuk melanjutkan dengan data yang diberikan.');
        return res.redirect_with_session('./');
      });

  });

  router.get('/reset-password/', function(req, res){

    var token = req.param('t');

    req.app.get('db_model').User.get_user_by_reset_password_token(token)
      .then(function(user){
        if (! user) {
          req.session.flash_error('Pranala pengaturan ulang kata sandi tidak diketahui, silakan ajukan kembali');
          return res.redirect_with_session('/forgot-password/')
        }

        res.render('reset_password',{
          url_to_the_site_root : get_url_to_site_root_for_anonymous_session(req),
          token : token,
        });
      });
  });

  router.post('/reset-password/', function(req, res){

    var token        = req.param('t'),
    password         = req.param('password'),
    confirm_password = req.param('confirm_password');


    if (password !== confirm_password) {
      req.session.flash_error('Konfirmasi kata sandi tidak sesuai dengan kata sandi awal');
      return res.redirect_with_session('/reset-password/?t='+token);
    }

    req.app.get('db_model').User.get_user_by_reset_password_token(token)
      .then(function(user){
        if (! user) {
          req.session.flash_error('Pranala pengaturan ulang kata sandi tidak diketahui, silakan ajukan kembali');
          return res.redirect_with_session('/forgot-password/');
        }

        return Promise.resolve(user);
      })
      .then(function(user){
        user.password = req.app.get('db_model').User.hashify_password(password);
        return user.save();
      })
      .then(function(user){
        var Email = new EmailTransport();

        return Email.promise_reset_password_email({
          user : user,
        });
      })
      .then(function(){
        req.session.flash_message('Silakan gunakan kata sandi baru untuk masuk log ke sistem');
          return res.redirect_with_session('/login/')
      });
  });

  return router;
};
