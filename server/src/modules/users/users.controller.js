import * as usersService from './users.service.js';

// Never send the password hash to the browser
function clean(user) {
  const { passwordHash, ...rest } = user.toObject ? user.toObject() : user;
  return rest;
}

export async function list(req, res) {
  res.json({ users: await usersService.listUsers(req.ctx) });
}

export async function create(req, res) {
  const { user, temporaryPassword } = await usersService.createUser(req.ctx, req.valid.body);
  res.status(201).json({ user: clean(user), temporaryPassword });
}

export async function update(req, res) {
  res.json({ user: clean(await usersService.updateUser(req.ctx, req.params.id, req.valid.body)) });
}

export async function resetPassword(req, res) {
  res.json(await usersService.resetPassword(req.ctx, req.params.id));
}

export async function setStatus(req, res) {
  res.json({ user: clean(await usersService.setUserStatus(req.ctx, req.params.id, req.valid.body.status)) });
}
