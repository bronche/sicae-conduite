// Adaptateur Netlify Lambda → Vercel Node.js
function netlifyCompat(handler) {
  return async (req, res) => {
    const url      = req.url || '';
    const basePath = url.split('?')[0];

    const qs = { ...req.query };
    delete qs.slug;

    // Vercel rewrites passent le sous-chemin via ?_p=
    const subPath = qs._p;
    delete qs._p;
    const pathOnly = subPath ? `${basePath}/${subPath}` : basePath;

    const body = req.body != null
      ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body))
      : null;

    const event = {
      httpMethod:            req.method,
      headers:               req.headers,
      path:                  pathOnly,
      queryStringParameters: qs,
      body,
    };

    try {
      const result = await handler(event);
      if (result.headers) {
        Object.entries(result.headers).forEach(([k, v]) => res.setHeader(k, v));
      }
      res.status(result.statusCode || 200).end(result.body);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
}

module.exports = { netlifyCompat };
