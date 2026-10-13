# k8s

Kustomize manifests for the web app. `base/` holds:

- `api-server`: the `jarvis-web` image, served through a headless service.
- `reverse-proxy`: nginx with TLS.
- `db-server`: Postgres 15 as a StatefulSet with a 5 Gi volume.
- Default-deny network policies.

Each overlay sets the namespace, image tag and replica counts:

| Overlay | Namespace | Tag | api / proxy replicas |
|---|---|---|---|
| `overlays/dev` | `dev` | `dev` | 1 / 1 |
| `test` | `test` | `dev` | 2 / 2 |
| `overlays/prod` | `prod` | `latest` (pin a sha on release) | 3 / 3 |

## First deploy

```bash
docker build -f web/Dockerfile -t jarvis-web:dev .              # from the repo root
kubectl create namespace dev
kubectl create secret generic web-env -n dev --from-env-file=web/.env   # DATABASE_URL host must be db-server
kubectl create secret generic db-env -n dev \
  --from-literal=POSTGRES_USER=postgres --from-literal=POSTGRES_PASSWORD=<pw> --from-literal=POSTGRES_DB=web
k8s/tls.sh dev                                                  # self-signed cert, or: k8s/tls.sh dev <domain> <cert> <key>
kubectl apply -k k8s/overlays/dev
```

The exact `db-env` keys are listed in the header of `base/db.yaml`. On kind or minikube, open the
proxy with `kubectl port-forward -n dev svc/reverse-proxy 8443:443` and go to https://localhost:8443.

## Day to day

- **Release prod:** `cd k8s/overlays/prod && kustomize edit set image jarvis-web=jarvis-web:<sha>`,
  then `kubectl apply -k .`
- **Edit `base/nginx.conf`:** the ConfigMap name is hashed, so applying rolls the proxy pods automatically.
- **Rotate TLS:** run `k8s/tls.sh <ns> …` again. It replaces the Secret and restarts the proxy.
- **Probes:** TCP only, until `web/src/app/api/health` has a route.
