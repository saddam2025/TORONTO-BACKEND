const sendControllerError = (res, error, fallbackMessage = 'Internal server error.') => {
  console.error('[Request error]', error);

  if ([400, 404, 409].includes(error?.statusCode)) {
    return res.status(error.statusCode).json({ success: false, message: error.message });
  }

  if (error?.code === 11000) {
    return res.status(409).json({ success: false, message: 'A record with these details already exists.' });
  }
  if (error?.name === 'ValidationError') {
    const fields = Object.keys(error.errors || {});
    return res.status(400).json({
      success: false,
      message: error.publicMessage || (fields.length ? `Invalid value for: ${fields.join(', ')}.` : 'Invalid request data.'),
    });
  }
  if (error?.name === 'CastError') {
    return res.status(400).json({ success: false, message: `Invalid value for ${error.path || 'a request field'}.` });
  }
  if (error?.name === 'SyntaxError') {
    return res.status(400).json({ success: false, message: 'Invalid request data.' });
  }

  const message = process.env.NODE_ENV === 'production' ? fallbackMessage : (error?.message || fallbackMessage);
  return res.status(500).json({ success: false, message });
};

module.exports = sendControllerError;
