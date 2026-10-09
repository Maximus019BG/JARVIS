#!/bin/sh
# HTTPS keys for the reverse proxy: puts a cert + key in the reverse-proxy-tls Secret
# (mounted by base/proxy.yaml, read by base/nginx.conf). Run before the first `kubectl apply -k`,
# and again to rotate — it restarts the proxy pods so nginx picks the new cert up.
#
#   k8s/tls.sh <namespace> [domain]               self-signed, for dev/test (default domain: localhost)
#   k8s/tls.sh <namespace> <domain> <cert> <key>  a real cert, e.g. Let's Encrypt fullchain.pem + privkey.pem
#
# Clients reject a self-signed cert until they trust it. Export it with:
#   kubectl get secret reverse-proxy-tls -n <ns> -o jsonpath='{.data.tls\.crt}' | base64 -d > jarvis.crt
# then add it to the OS keychain, or NODE_EXTRA_CA_CERTS=jarvis.crt for the TUI.
set -eu

ns=${1:?usage: k8s/tls.sh <namespace> [domain] [cert key]}
domain=${2:-localhost}
cert=${3:-}
key=${4:-}

if [ -z "$cert" ]; then
  # Key never touches the repo: generated in a temp dir, stored only in the Secret.
  dir=$(mktemp -d)
  trap 'rm -rf "$dir"' EXIT
  cert=$dir/tls.crt
  key=$dir/tls.key
  case $domain in
    *[!0-9.]*) san="DNS:$domain" ;;
    *) san="IP:$domain" ;;
  esac
  # 825 days: the longest validity macOS/iOS accept for a hand-trusted cert.
  openssl req -x509 -newkey rsa:2048 -nodes -days 825 -subj "/CN=$domain" \
    -addext "subjectAltName=$san,DNS:localhost,IP:127.0.0.1" \
    -keyout "$key" -out "$cert" 2>/dev/null
  echo "Generated self-signed cert for $domain (825 days)."
fi

# kubectl rejects a cert/key pair that doesn't match, so a wrong file fails here, not in nginx.
kubectl create namespace "$ns" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl create secret tls reverse-proxy-tls -n "$ns" --cert="$cert" --key="$key" \
  --dry-run=client -o yaml | kubectl apply -f -

if kubectl get deployment/reverse-proxy -n "$ns" >/dev/null 2>&1; then
  kubectl rollout restart deployment/reverse-proxy -n "$ns"
fi
