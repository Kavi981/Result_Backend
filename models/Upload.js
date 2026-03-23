const mongoose = require('mongoose');

const UploadSchema = new mongoose.Schema({
    batchId: { type: String, required: true },
    fileName: { type: String, required: true },
    uploadedBy: { type: String, default: "admin" },
    uploadedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Upload', UploadSchema);
