const mongoose = require('mongoose');

const StudentSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    name: { type: String, required: true },
    semester: { type: Number, required: true },
    isFirstLogin: { type: Boolean, default: true }
});

module.exports = mongoose.model('Student', StudentSchema);
