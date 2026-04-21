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
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

log() { echo "[bootstrap] $*"; }

if [[ ! -f "$SEALED_SECRETS_KEY_BACKUP" ]]; then
  log "ERROR: master key backup not found at $SEALED_SECRETS_KEY_BACKUP"
  log "Without it the controller will generate a new key and SealedSecrets in git will fail to decrypt."
  exit 1
fi

log "1/6 applying namespaces"
kubectl apply -f "$REPO_ROOT/k8s/namespaces.yaml"

log "2/6 restoring SealedSecrets master key before controller install"
kubectl apply -f "$SEALED_SECRETS_KEY_BACKUP"

log "3/6 installing SealedSecrets controller $SEALED_SECRETS_VERSION"
kubectl apply -f "https://github.com/bitnami-labs/sealed-secrets/releases/download/${SEALED_SECRETS_VERSION}/controller.yaml"
kubectl -n kube-system rollout status deployment/sealed-secrets-controller --timeout=180s

log "4/6 applying SealedSecrets"
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

log "5/6 applying data + monitoring stack"
kubectl apply -f "$REPO_ROOT/k8s/postgres.yaml"
kubectl apply -f "$REPO_ROOT/k8s/influxdb.yaml"
kubectl apply -f "$REPO_ROOT/k8s/grafana.yaml"
kubectl -n data wait --for=condition=ready pod -l app=postgres --timeout=300s
kubectl -n monitoring wait --for=condition=ready pod -l app=influxdb --timeout=300s

log "6/6 applying microservices"
kubectl apply -f "$REPO_ROOT/k8s/user-service.yaml"
kubectl apply -f "$REPO_ROOT/k8s/order-service.yaml"
kubectl wait --for=condition=ready pod -l app=user-service --timeout=300s
kubectl wait --for=condition=ready pod -l app=order-service --timeout=300s

log "applying NetworkPolicies"
kubectl apply -f "$REPO_ROOT/k8s/networkpolicies.yaml"

log "applying postgres backup CronJob"
kubectl apply -f "$REPO_ROOT/k8s/postgres-backup.yaml"

log "done"
