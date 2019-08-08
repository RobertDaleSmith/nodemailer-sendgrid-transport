'use strict';

var SendGrid = require('@sendgrid/mail');
var packageData = require('../package.json');

module.exports = function(options) {
  return new SendGridTransport(options);
};

function SendGridTransport(options) {
  options = options || {};

  this.options = options;
  this.name = 'SendGrid';
  this.version = packageData.version;

  // api key
  SendGrid.setApiKey(this.options.auth.api_key);
}

SendGridTransport.prototype.send = function(mail, callback) {
  var email = mail.data;

  // fetch envelope data from the message object
  var addresses = mail.message.getAddresses();
  var from = [].concat(addresses.from || addresses.sender || addresses['reply-to'] || []).shift();
  var reply = [].concat(addresses.replyTo || []);
  var to = [].concat(addresses.to || []);
  var cc = [].concat(addresses.cc || []);
  var bcc = [].concat(addresses.bcc || []);

  // populate from email and name
  if (from && from.address) {
    email.from = {
      email: from.address,
    };

    if (from.name) {
      email.from.name = from.name;
    }
  }

  // populate reply_to email and name
  if (reply && reply.address) {
    email.reply_to = {
      email: reply.address,
    };

    if (reply.name) {
      email.reply_to.name = reply.name;
    }
  }

  // populate to and toname arrays
  email.to = to.map(function(rcpt) {
    return rcpt && rcpt.address ? {
      email: rcpt.address,
      name: rcpt.name || ''
    } : '';
  });

  // populate cc and bcc arrays
  email.cc = cc.map(function(rcpt) {
    return rcpt && rcpt.address ? {
      email: rcpt.address,
      name: rcpt.name || ''
    } : '';
  });

  email.bcc = cc.map(function(rcpt) {
    return rcpt && rcpt.address ? {
      email: rcpt.address,
      name: rcpt.name || ''
    } : '';
  });

  // a list for processing attachments
  var contents = [];

  // email.text could be a stream or a file, so store it for processing
  if (email.text) {
    contents.push({
      obj: email,
      key: 'text'
    });
  }

  // email.html could be a stream or a file, so store it for processing
  if (email.html) {
    contents.push({
      obj: email,
      key: 'html'
    });
  }

  // store attachments for processing, to fetch files, urls and streams
  email.files = email.attachments;
  [].concat(email.files || []).forEach(function(attachment, i) {
    contents.push({
      obj: email.files,
      key: i,
      isAttachment: true
    });
  });

  // fetch values for text/html/attachments as strings or buffers
  // this is an asynchronous action, so we'll handle it with a simple recursion
  var _self = this;
  var pos = 0;
  var resolveContent = function() {

    // if all parts are processed, send out the e-mail
    if (pos >= contents.length) {
      return SendGrid.send(email, function(err, json) {
        callback(err, json[0]);
      });
    }

    // get the next element from the processing list
    var file = contents[pos++];
    /*
       We need to store a pointer to the original attachment object in case
       resolveContent replaces it with the Stream value
     */
    var prevObj = file.obj[file.key];
    // ensure the object is an actual attachment object, not a string, buffer or a stream
    if (prevObj instanceof Buffer ||  typeof prevObj === 'string' || (prevObj && typeof prevObj.pipe === 'function')) {
      prevObj = {
        content: prevObj
      };
    }

    // use the helper function to convert file paths, urls and streams to strings or buffers
    mail.resolveContent(file.obj, file.key, function(err, content) {
      if (err) {
        return callback(err);
      }

      if (!file.isAttachment) {
        // overwrites email.text and email.html content
        file.obj[file.key] = content;
      } else {

        // If the object is a String or a Buffer then it is most likely replaces by resolveContent
        if (file.obj[file.key] instanceof Buffer ||  typeof file.obj[file.key] === 'string') {
          file.obj[file.key] = prevObj;
        }
        file.obj[file.key].content = content;
        if (file.obj[file.key].path) {
          if (!file.obj[file.key].filename) {
            // try to detect the required filename from the path
            file.obj[file.key].filename = file.obj[file.key].path.split(/[\\\/]/).pop();
          }
          delete file.obj[file.key].path;
        }
        // set default filename if filename and content-type are not set (allowed for Nodemailer but not for SendGrid)
        if (!file.obj[file.key].filename && !file.obj[file.key].contentType) {
          file.obj[file.key].filename = 'attachment-' + pos + '.bin';
        }
      }

      resolveContent();
    });
  };

  // start the recursive function
  resolveContent();
};
