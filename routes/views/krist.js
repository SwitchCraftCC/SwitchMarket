const _ = require("lodash");

const keystone = require("keystone");
const Product = keystone.list("Product");
const Bid = keystone.list("Bid");

const request = require("request-promise");
const kristUtils = require("krist-utils");
const moment = require("moment");

const PRIVATEKEY = process.env.KRIST_PRIVATEKEY;
const ADDRESS = kristUtils.makeV2Address(PRIVATEKEY);
const WEBHOOK_TOKEN = process.env.KRIST_WEBHOOK_TOKEN;

let io;

exports = module.exports = async function(req, res) {
  if (!io) io = keystone.get("io");
  
  if (
       !req.body 
    || !req.body.token 
    ||  req.body.token !== WEBHOOK_TOKEN 
    || !req.body.event 
    ||  req.body.event !== "transaction" 
    || !req.body.transaction
    ||  req.body.transaction.to !== ADDRESS
  ) return res.status(400).send("die");

  const transaction = req.body.transaction;
  const meta = kristUtils.parseCommonMeta(transaction.metadata);
  
  function sendTransaction(to, amount, metadata) {
    return request
      .post("https://krist.ceriat.net/transactions")
      .form({
        privatekey: PRIVATEKEY,
        to, amount, metadata
      });    
  }
  
  async function refundTransaction(refundReason) {
    refundReason += ` (send to \`product@${res.locals.marketName}\` to bid)`;
    await sendTransaction(meta && meta.return ? meta.return : req.body.transaction.from, req.body.transaction.value, `error=${refundReason}`);
  }
  
  if (!meta) return await refundTransaction("Could not parse CommonMeta");
  if (!meta.username) return await refundTransaction("Username not specified");
  if (!meta.metaname) return await refundTransaction("Metaname not specified");
    
  const metaname = meta.metaname;
  const product = await Product.model.findOne({
    slug: metaname
  })
    .populate("currentBid")
    .exec();
  
  if (!product) return await refundTransaction("Product not found");

  const now = moment();
  const ends = moment(product.endsAt);
  
  if (product.sold || now.isAfter(ends)) return await refundTransaction("Auction already over");
  
  if (product.currentBid) {
    const currentBid = product.currentBid;
    
    if (req.body.transaction.value <= currentBid.amount) return await refundTransaction("Not enough to out-bid current bid");
    
    const message = req.body.transaction.from === currentBid.address 
      ? `return=${product.slug}@${res.locals.marketName};message=You out-bid yourself on ${product.name}.`      
      : `return=${product.slug}@${res.locals.marketName};message=You were out-bid on ${product.name}! Send to \`${product.slug}@${res.locals.marketName}\` to bid again.`;
    
    sendTransaction(
      currentBid.address, 
      currentBid.amount, 
      message
    );
  }

  const newBid = new Bid.model({
    item: product,
    address: meta.return || req.body.transaction.from,
    amount: req.body.transaction.value,
    username: meta.username
  });
  await newBid.save();
  
  product.currentBid = newBid._id;
  
  if (product.extensionMinutes > 0 && moment(now).add(product.extensionMinutes, "minutes").isAfter(ends)) {
    console.log(`Extending ${product.name}'s time`);
    product.endsAt = moment(now).add(product.extensionMinutes, "minutes").toDate();
  }
  
  await product.save();
  
  io.sockets.emit("bid", _.omit(product, ["createdBy", "updatedBy"]));
  
  keystone.get("log")(`:arrow_down: **${newBid.amount} KST** bid on **${product.name}** by **${newBid.username}** (${newBid.address})`, product);
  
  return res.send("ya");
};
