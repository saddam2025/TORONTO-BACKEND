module.exports = (error, req, res, next) => {
  if (res.headersSent) return next(error);

  console.error('[Unhandled request error]', error);
  const status = error.type === 'entity.too.large'
    ? 413
    : (error.name === 'MulterError' ? 400 : (error.status || error.statusCode || 500));
  const isProduction = process.env.NODE_ENV === 'production';
  const message = isProduction
    ? (status === 413 ? 'Request body is too large.' : (status < 500 ? error.publicMessage || 'Request could not be completed.' : 'Internal server error.'))
    : (error.message || 'Internal server error.');

  return res.status(status).json({ success: false, message });
};
