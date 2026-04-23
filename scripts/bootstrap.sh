#!/usr/bin/env bash
# Post-`terraform apply` bootstrap.
# Reconstructs the full cluster state from git + the locally backed-up
# SealedSecrets master key.
#
# Prerequisites:
#   - kubectl already pointed at the target cluster
#   - kubeseal master key backup at $SEALED_SECRETS_KEY_BACKUP
#     (default: ~/tfg-sealedsecrets-master.yaml)

set -euo pipefail

SEALED_SECRETS_KEY_BACKUP="${SEALED_SECRETS_KEY_BACKUP:-$HOME/tfg-sealedsecrets-master.yaml}"
SEALED_SECRETS_VERSION="${SEALED_SECRETS_VERSION:-v0.27.1}"
ARGOCD_VERSION="${ARGOCD_VERSION:-stable}"
ARGOCD_IMAGE_UPDATER_VERSION="${ARGOCD_IMAGE_UPDATER_VERSION:-v0.16.0}"
INGRESS_NGINX_VERSION="${INGRESS_NGINX_VERSION:-controller-v1.11.3}"
CERT_MANAGER_VERSION="${CERT_MANAGER_VERSION:-v1.15.3}"
INGRESS_STATIC_IP="${INGRESS_STATIC_IP:-34.77.210.246}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

log() { echo "[bootstrap] $*"; }

if [[ ! -f "$SEALED_SECRETS_KEY_BACKUP" ]]; then
  log "ERROR: master key backup not found at $SEALED_SECRETS_KEY_BACKUP"
  log "Without it the controller will generate a new key and SealedSecrets in git will fail to decrypt."
  exit 1
fi

log "1/8 applying namespaces"
kubectl apply -f "$REPO_ROOT/k8s/namespaces.yaml"

log "2/8 restoring SealedSecrets master key before controller install"
kubectl apply -f "$SEALED_SECRETS_KEY_BACKUP"

log "3/8 installing SealedSecrets controller $SEALED_SECRETS_VERSION"
kubectl apply -f "https://github.com/bitnami-labs/sealed-secrets/releases/download/${SEALED_SECRETS_VERSION}/controller.yaml"
kubectl -n kube-system rollout status deployment/sealed-secrets-controller --timeout=180s

log "4/8 applying SealedSecrets"
kubectl apply -f "$REPO_ROOT/k8s/sealed-postgres-credentials.yaml"
kubectl apply -f "$REPO_ROOT/k8s/sealed-app-db.yaml"
kubectl apply -f "$REPO_ROOT/k8s/sealed-influxdb-admin.yaml"
kubectl apply -f "$REPO_ROOT/k8s/sealed-influxdb-token.yaml"

log "waiting for controller to materialize Secrets"
for s in data/postgres-credentials default/app-db monitoring/influxdb-admin default/influxdb-token; do
  ns="${s%%/*}"; name="${s##*/}"
  for i in {1..30}; do
    if kubectl -n "$ns" get secret "$name" >/dev/null 2>&1; then break; fi
    sleep 2
  done
  kubectl -n "$ns" get secret "$name" >/dev/null
done

log "5/8 applying data + monitoring stack"
kubectl apply -f "$REPO_ROOT/k8s/postgres.yaml"
kubectl apply -f "$REPO_ROOT/k8s/influxdb.yaml"
kubectl apply -f "$REPO_ROOT/k8s/grafana.yaml"
kubectl -n data wait --for=condition=ready pod -l app=postgres --timeout=300s
kubectl -n monitoring wait --for=condition=ready pod -l app=influxdb --timeout=300s

log "6/9 applying microservices + network policies + backup CronJob"
kubectl apply -f "$REPO_ROOT/k8s/user-service.yaml"
kubectl apply -f "$REPO_ROOT/k8s/order-service.yaml"
kubectl wait --for=condition=ready pod -l app=user-service --timeout=300s
kubectl wait --for=condition=ready pod -l app=order-service --timeout=300s
kubectl apply -f "$REPO_ROOT/k8s/networkpolicies.yaml"
kubectl apply -f "$REPO_ROOT/k8s/postgres-backup.yaml"

log "7/9 installing ingress-nginx ($INGRESS_NGINX_VERSION) and cert-manager ($CERT_MANAGER_VERSION)"
kubectl apply -f "https://raw.githubusercontent.com/kubernetes/ingress-nginx/${INGRESS_NGINX_VERSION}/deploy/static/provider/cloud/deploy.yaml"
kubectl -n ingress-nginx wait --for=condition=ready pod -l app.kubernetes.io/component=controller --timeout=300s
kubectl -n ingress-nginx patch svc ingress-nginx-controller \
  -p "{\"spec\":{\"loadBalancerIP\":\"${INGRESS_STATIC_IP}\"}}"

kubectl apply -f "https://github.com/cert-manager/cert-manager/releases/download/${CERT_MANAGER_VERSION}/cert-manager.yaml"
kubectl -n cert-manager wait --for=condition=ready pod -l app.kubernetes.io/instance=cert-manager --timeout=300s

log "applying ClusterIssuer + Ingress (TLS certificate will be issued by Let's Encrypt)"
kubectl apply -f "$REPO_ROOT/k8s/cluster-issuer.yaml"
kubectl apply -f "$REPO_ROOT/k8s/ingress.yaml"

log "8/9 installing ArgoCD ($ARGOCD_VERSION) and Image Updater ($ARGOCD_IMAGE_UPDATER_VERSION)"
kubectl create namespace argocd --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -n argocd -f "https://raw.githubusercontent.com/argoproj/argo-cd/${ARGOCD_VERSION}/manifests/install.yaml"
kubectl -n argocd rollout status deployment/argocd-server --timeout=300s
kubectl -n argocd rollout status deployment/argocd-repo-server --timeout=300s
kubectl -n argocd rollout status statefulset/argocd-application-controller --timeout=300s

kubectl apply -n argocd -f "https://raw.githubusercontent.com/argoproj-labs/argocd-image-updater/${ARGOCD_IMAGE_UPDATER_VERSION}/manifests/install.yaml"
kubectl -n argocd rollout status deployment/argocd-image-updater --timeout=180s

log "9/9 registering tfg-cloudpipeline Application + exposing ArgoCD at /argocd"
kubectl apply -f "$REPO_ROOT/k8s/argocd-ingress.yaml"
kubectl -n argocd rollout status deployment argocd-server --timeout=180s
kubectl apply -f "$REPO_ROOT/k8s/argocd-app.yaml"

log "done — ArgoCD is now the authoritative reconciler for k8s/"
log "  ArgoCD UI: kubectl -n argocd port-forward svc/argocd-server 8080:443"
log "  Initial admin password:"
log "    kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d; echo"
