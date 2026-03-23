const mongoose = require('mongoose');

const SheetDataSchema = new mongoose.Schema({
    batchId: { type: String, required: true },
    // Using strict: false allows us to store arbitrary columns from the excel sheet
    // without defining them in advance.
    data: { type: mongoose.Schema.Types.Mixed }
}, { strict: false });

module.exports = mongoose.model('SheetData', SheetDataSchema);
