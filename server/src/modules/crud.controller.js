// The usual endpoints for a simple salon record (services, combos, branches, staff).
// { one, many }: the key the reply uses; the rest are the service functions to call.
export function crudController({ one, many }, { list, getOne, create, update, setStatus }) {
  return {
    list: async (req, res) => res.json({ [many]: await list(req.ctx) }),
    getOne: async (req, res) => res.json({ [one]: await getOne(req.ctx, req.params.id) }),
    create: async (req, res) => res.status(201).json({ [one]: await create(req.ctx, req.valid.body) }),
    update: async (req, res) => res.json({ [one]: await update(req.ctx, req.params.id, req.valid.body) }),
    setStatus: async (req, res) => res.json({ [one]: await setStatus(req.ctx, req.params.id, req.valid.body.status) }),
  };
}
