import * as authService from './auth.service.js';

export async function login(req, res) {
  const { user, org } = await authService.login(req.valid.body);
  const branches = await authService.getAllowedBranches(user);

  res.cookie(authService.COOKIE_NAME, authService.signToken(user._id), authService.cookieOptions);
  res.json({ user: authService.toSessionUser(user, org, branches) });
}

export function logout(req, res) {
  res.clearCookie(authService.COOKIE_NAME, authService.cookieOptions);
  res.json({ ok: true });
}

// "Who am I?" The frontend calls this on page load to know if someone is logged in.
export async function me(req, res) {
  const branches = await authService.getAllowedBranches(req.user);
  res.json({ user: authService.toSessionUser(req.user, req.org, branches) });
}
