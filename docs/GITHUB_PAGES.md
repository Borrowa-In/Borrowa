# Publishing on GitHub Pages

The website lives in the `public/` folder, so GitHub needs to be told to serve that folder.

## Option A (recommended): GitHub Actions
1. Upload everything in this project to your repo (including the hidden `.github` and `.nojekyll`).
2. Repo **Settings -> Pages -> Build and deployment -> Source: GitHub Actions**.
3. Open the **Actions** tab, wait for "Deploy site to GitHub Pages" to turn green.
4. Your site is at `https://YOUR-USERNAME.github.io/YOUR-REPO/` (it opens the landing page).

## Option B: no Actions
Settings -> Pages -> Source: "Deploy from a branch" -> `main` / `(root)`. The root `index.html`
forwards visitors to `public/index.html`. This only works if `public/` is at the TOP of the repo
(upload the contents of the project folder, not the folder itself).

## Required for login to work (both options)
Firebase console -> **Authentication -> Settings -> Authorized domains -> Add domain**:
`YOUR-USERNAME.github.io`. Without it, sign-up / login / password reset fail on GitHub.
