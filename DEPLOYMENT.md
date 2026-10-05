# Toronto deployment

## Vercel frontend

Create a Vercel project with `toronto-frontend` as its Root Directory. Use the Vite defaults:

- Build command: `npm run build`
- Output directory: `dist`
- Environment variable: `VITE_API_BASE_URL=https://<Railway-domain>/api`

The existing `vercel.json` rewrite supports client-side routes. Vite variables are embedded at build time, so redeploy after changing the API URL.

## Railway backend

Create a Railway service with `toronto-backend` as its Root Directory. Railway reads `railway.json`, starts the service with `npm start`, and checks `/` for health. Railway supplies `PORT`; do not hardcode it.

Set these service variables in Railway:

- `NODE_ENV=production`
- `MONGO_URI`: a MongoDB Atlas connection string, with Railway's outbound network access allowed in Atlas.
- `JWT_SECRET`: a long, random private value.
- `CLIENT_URL`: the exact Vercel origin, such as `https://your-store.vercel.app`. Multiple origins can be comma-separated.
- `PAYMOB_API_KEY`, `PAYMOB_INTEGRATION_ID_CARD`, `PAYMOB_IFRAME_ID`, and `PAYMOB_HMAC_SECRET` for card payments. Keep them blank/omitted only if you are not enabling Paymob.
- `MANAGER_EMAIL` is optional.

The server saves product images under `uploads/`. Railway's service filesystem is ephemeral, so attach a Railway Volume mounted at `/app/uploads` to preserve uploaded images across deploys. The app creates the directory if it is empty.

After Railway gives you a public domain, set that URL in Vercel's `VITE_API_BASE_URL`, redeploy Vercel, then set the final Vercel URL in Railway's `CLIENT_URL`. Restart/redeploy Railway after changing variables.

Use `.env.example` as a key list for local development. Do not commit real `.env` files or put backend secrets in Vercel. The production credentials still need to be supplied in the corresponding hosting dashboards.
