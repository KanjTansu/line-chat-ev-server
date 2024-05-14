const mongoose = require('mongoose');

const distanceSchema = new mongoose.Schema(
  {
    km: Number,
    price: Number,
    createAt: Date,
  },
  { timestamps: true, versionKey: false }
);

const DistanceModel = mongoose.model('Distance', distanceSchema);

module.exports = DistanceModel;
