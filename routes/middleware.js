const _ = require("lodash");

exports.initLocals = function(req, res, next) {
  res.locals.navLinks = [
		{ label: "Home", key: "home", href: "/" },
		{ label: "Products", key: "products", href: "/products" }
  ];
  res.locals.marketName = process.env.MARKET_NAME || "switchmarket.kst";
  res.locals.user = req.user;
  next();
};

exports.flashMessages = function(req, res, next) {
  const flashMessages = {
    info: req.flash("info"),
    success: req.flash("success"),
    warning: req.flash("warning"),
    error: req.flash("error")
  };
  res.locals.messages = _.some(flashMessages, function(msgs) { return msgs.length; }) ? flashMessages : false;
  next();
};

exports.requireUser = function(req, res, next) {
  if (!req.user) {
    req.flash("error", "Please sign in to access this page.");
    res.redirect("/keystone/signin");
  } else {
    next();
  }
};
