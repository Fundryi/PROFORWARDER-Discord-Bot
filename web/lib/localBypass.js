function normalizeIp(ip) {
  if (!ip || typeof ip !== 'string') return '';
  return ip.trim().toLowerCase();
}

function normalizeHost(hostHeader) {
  if (!hostHeader || typeof hostHeader !== 'string') return '';
  const host = hostHeader.trim().toLowerCase();
  if (host.startsWith('[')) {
    const closingBracket = host.indexOf(']');
    if (closingBracket > 1) {
      return host.slice(1, closingBracket);
    }
  }
  return host.split(':')[0];
}

function evaluateLocalBypassRequest(req, webAdminConfig) {
  const host = normalizeHost(req.get('host') || req.headers.host || '');
  const remoteIp = normalizeIp(req.socket?.remoteAddress || req.ip || '');
  const allowedHosts = new Set((webAdminConfig.localBypassAllowedHosts || []).map(normalizeHost));
  const allowedIps = new Set((webAdminConfig.localBypassAllowedIps || []).map(normalizeIp));

  if (!webAdminConfig.localBypassAuth) {
    return {
      allowed: false,
      reason: 'local bypass is disabled',
      host,
      remoteIp
    };
  }

  if (webAdminConfig.trustProxy) {
    return {
      allowed: false,
      reason: 'trust proxy is enabled',
      host,
      remoteIp
    };
  }

  if (allowedHosts.size > 0 && !allowedHosts.has(host)) {
    return {
      allowed: false,
      reason: `host "${host}" is not allowlisted`,
      host,
      remoteIp
    };
  }

  if (allowedIps.size > 0 && !allowedIps.has(remoteIp)) {
    return {
      allowed: false,
      reason: `remote ip "${remoteIp}" is not allowlisted`,
      host,
      remoteIp
    };
  }

  return {
    allowed: true,
    reason: 'request matched local bypass host/ip allowlists',
    host,
    remoteIp
  };
}

module.exports = {
  evaluateLocalBypassRequest
};
