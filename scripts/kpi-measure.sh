#!/usr/bin/env bash
# KPI measurement runner.
# Maps each block to a KPI defined in the memoria Cap.3.3.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${OUT_DIR:-$REPO_ROOT/kpi-results}"
mkdir -p "$OUT_DIR"
TS="$(date -u +%Y%m%dT%H%M%SZ)"

banner() { echo; echo "=============================="; echo "  $*"; echo "=============================="; }

# ---------- KPI 1: commit → producción end-to-end ----------
kpi1_deploy_time() {
  banner "KPI 1: tiempo commit → pod Ready"
  local csv="$OUT_DIR/kpi1-cycles.csv"
  if [[ ! -f "$csv" ]]; then
    echo "run,t_commit_to_ci_done_s,t_ci_to_pod_ready_s,total_s,ci_run_id,new_image_sha" > "$csv"
  fi
  local run="${1:-1}"

  # sanity checks
  command -v gh >/dev/null || { echo "gh CLI required"; return 1; }
  git -C "$REPO_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 1

  local t0 t1 t2
  t0=$(date +%s)
  local commit_msg="kpi1: measure deploy cycle $(date -u +%Y%m%dT%H%M%SZ)"
  git -C "$REPO_ROOT" commit --allow-empty -m "$commit_msg" >/dev/null
  git -C "$REPO_ROOT" push >/dev/null 2>&1
  local sha=$(git -C "$REPO_ROOT" rev-parse HEAD)
  echo "[kpi1] pushed empty commit $sha, watching CI…"

  # Wait briefly so the run appears
  sleep 5
  local run_id
  run_id=$(gh run list --workflow=ci.yaml --limit 1 --json databaseId --jq '.[0].databaseId')
  gh run watch "$run_id" --exit-status >/dev/null 2>&1 || {
    echo "[kpi1] CI failed or timed out"; return 1;
  }
  t1=$(date +%s)
  echo "[kpi1] CI finished ($run_id). Waiting for Image Updater + ArgoCD sync + rollout…"

  # Wait until the user-service pod runs the new image SHA
  local deadline=$((t1 + 600))
  while (( $(date +%s) < deadline )); do
    local running_sha
    running_sha=$(kubectl get deployment user-service -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null \
      | awk -F: '{print $2}')
    if [[ "$running_sha" == "$sha" ]]; then
      kubectl rollout status deployment/user-service --timeout=120s >/dev/null
      break
    fi
    sleep 5
  done
  t2=$(date +%s)

  local running_sha
  running_sha=$(kubectl get deployment user-service -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null)
  echo "[kpi1] Final running image: $running_sha"

  local ci_s=$((t1 - t0))
  local deploy_s=$((t2 - t1))
  local total=$((t2 - t0))
  echo "$run,$ci_s,$deploy_s,$total,$run_id,$sha" | tee -a "$csv"
}

# ---------- KPI 2: Pipeline success without manual intervention ----------
kpi2_pipeline() {
  banner "KPI 2: tasa de éxito de los últimos N runs de CI"
  gh run list --workflow=ci.yaml --limit 20 --json conclusion,createdAt,displayTitle \
    | jq -r '.[] | [.createdAt, .conclusion, .displayTitle] | @tsv' \
    | tee "$OUT_DIR/kpi2-$TS.tsv"
  echo
  gh run list --workflow=ci.yaml --limit 20 --json conclusion \
    | jq -r '[.[] | .conclusion] | group_by(.) | map({status: .[0], count: length})'
}

# ---------- KPI 3: HTTP availability during demo ----------
kpi3_availability() {
  banner "KPI 3: tasa de éxito HTTP sobre 100 peticiones por endpoint"
  kubectl port-forward svc/user-service 3000:80 >/dev/null 2>&1 &
  PF_U=$!
  kubectl port-forward svc/order-service 3001:80 >/dev/null 2>&1 &
  PF_O=$!
  sleep 3
  trap "kill $PF_U $PF_O 2>/dev/null || true" RETURN

  # seed user
  curl -s -X POST http://localhost:3000/users \
    -H "Content-Type: application/json" \
    -d '{"email":"kpi@test.es","name":"KPI"}' >/dev/null

  local total=100
  local file="$OUT_DIR/kpi3-$TS.csv"
  echo "endpoint,total,ok_count,success_rate_pct,p50_ms,p95_ms,p99_ms" > "$file"

  measure() {
    local label="$1" cmd="$2"
    local ok=0
    : > /tmp/kpi3-times.txt
    for _ in $(seq 1 $total); do
      local resp
      resp=$(eval "$cmd")
      local code=$(echo "$resp" | awk -F, '{print $1}')
      local time=$(echo "$resp" | awk -F, '{print $2}')
      [[ "$code" =~ ^2 ]] && ok=$((ok + 1))
      echo "$time" >> /tmp/kpi3-times.txt
    done
    sort -n /tmp/kpi3-times.txt > /tmp/kpi3-sorted.txt
    local p50 p95 p99
    p50=$(awk -v n=$total 'NR==int(n*0.50){printf "%.0f", $1*1000}' /tmp/kpi3-sorted.txt)
    p95=$(awk -v n=$total 'NR==int(n*0.95){printf "%.0f", $1*1000}' /tmp/kpi3-sorted.txt)
    p99=$(awk -v n=$total 'NR==int(n*0.99){printf "%.0f", $1*1000}' /tmp/kpi3-sorted.txt)
    echo "$label,$total,$ok,$((ok * 100 / total)),$p50,$p95,$p99" | tee -a "$file"
  }

  measure "GET_users" \
    "curl -s -o /dev/null -w '%{http_code},%{time_total}' http://localhost:3000/users"
  measure "GET_user_by_id" \
    "curl -s -o /dev/null -w '%{http_code},%{time_total}' http://localhost:3000/users/1"
  measure "POST_order_valid" \
    "curl -s -o /dev/null -w '%{http_code},%{time_total}' -X POST http://localhost:3001/orders -H 'Content-Type: application/json' -d '{\"user_id\":1,\"product\":\"P\",\"amount\":1}'"
  measure "POST_order_invalid_user" \
    "curl -s -o /dev/null -w '%{http_code},%{time_total}' -X POST http://localhost:3001/orders -H 'Content-Type: application/json' -d '{\"user_id\":9999,\"product\":\"X\",\"amount\":1}'"

  # NOTE: POST_order_invalid_user devuelve 404 a propósito (cross-validation).
  # Para el KPI de disponibilidad, se considera "200 OR 404 del cross-validation"
  # como éxito, ya que el servicio respondió correctamente.
  echo
  echo "Nota: POST_order_invalid_user devuelve 404 por diseño (validación cruzada)."
  echo "Para KPI 3 la disponibilidad se mide contra GET_users, GET_user_by_id y POST_order_valid."
}

# ---------- KPI 4: monitoring coverage ----------
kpi4_monitoring() {
  banner "KPI 4: métricas de CPU/memoria disponibles para todos los servicios"
  kubectl top pods -A --sort-by=cpu 2>&1 | grep -E "user-service|order-service|postgres|influxdb|grafana|NAME" \
    | tee "$OUT_DIR/kpi4-$TS.txt"
  echo
  echo "HTTP metrics en InfluxDB (measurement http_requests):"
  kubectl -n monitoring exec deployment/influxdb -- \
    influx query --org tfg \
      'from(bucket:"metrics") |> range(start:-1h) |> filter(fn:(r) => r._measurement == "http_requests") |> group(columns:["service"]) |> count()' 2>&1 \
    | tee -a "$OUT_DIR/kpi4-$TS.txt" || echo "(InfluxDB query failed — revisa el token si no hay salida)"
}

# ---------- KPI 5: reproducibility time ----------
kpi5_reproducibility() {
  banner "KPI 5: ciclo completo destroy → apply → bootstrap (cronometrado)"
  local run="${1:-1}"
  local csv="$OUT_DIR/kpi5-cycles.csv"
  if [[ ! -f "$csv" ]]; then
    echo "run,destroy_s,apply_s,bootstrap_s,total_create_s,total_cycle_s" > "$csv"
  fi

  local t0 t1 t2 t3
  t0=$(date +%s)
  (cd "$REPO_ROOT/terraform" && terraform destroy -auto-approve) \
    > "$OUT_DIR/kpi5-$run-destroy.log" 2>&1
  t1=$(date +%s)

  (cd "$REPO_ROOT/terraform" && terraform apply -auto-approve) \
    > "$OUT_DIR/kpi5-$run-apply.log" 2>&1
  t2=$(date +%s)

  gcloud container clusters get-credentials tfg-cluster \
    --zone europe-west1-b --project tfg-cloudpipeline > /dev/null 2>&1

  (cd "$REPO_ROOT" && ./scripts/bootstrap.sh) \
    > "$OUT_DIR/kpi5-$run-bootstrap.log" 2>&1
  t3=$(date +%s)

  local d=$((t1 - t0)) a=$((t2 - t1)) b=$((t3 - t2))
  local create=$((a + b)) cycle=$((t3 - t0))
  echo "$run,$d,$a,$b,$create,$cycle" | tee -a "$csv"
}

# ---------- KPI 6: secrets management (no plaintext creds in repo) ----------
kpi6_secrets() {
  banner "KPI 6: verificación de secretos en texto plano en el repositorio"
  local report="$OUT_DIR/kpi6-$TS.txt"
  {
    echo "== Grep de posibles credenciales en el historial de git =="
    git -C "$REPO_ROOT" log --all -p \
      | grep -iE '(password|passwd|token|api[_-]?key|secret[_-]?key|bearer)' \
      | grep -viE '(secretKeyRef|SealedSecret|sealed-secrets|kind: Secret|INFLUXDB_TOKEN|DATABASE_URL|POSTGRES_PASSWORD|postgres-credentials|influxdb-admin|app-db|\.gitignore|namespace|description|key:)' \
      | head -20 || echo "(sin coincidencias)"

    echo
    echo "== SealedSecrets commiteados =="
    ls "$REPO_ROOT"/k8s/sealed-*.yaml 2>/dev/null || echo "ninguno"

    echo
    echo "== Ficheros sospechosos en tracked paths =="
    git -C "$REPO_ROOT" ls-files | grep -iE '(credential|\.env$|\.pem$|\.key$|tfvars|service-account.*\.json|gcp-credentials)' \
      || echo "ninguno"

    echo
    echo "== Master key de SealedSecrets (debe estar FUERA del repo) =="
    if git -C "$REPO_ROOT" ls-files | grep -q sealedsecrets-master; then
      echo "FAIL: master key tracked in git"
    else
      echo "PASS: master key no está en git"
      ls -l "$HOME/tfg-sealedsecrets-master.yaml" 2>&1
    fi
  } | tee "$report"
}

# ---------- dispatcher ----------
usage() {
  cat <<EOF
Usage: $0 <kpi>

KPIs:
  1 [N]     Deploy time cycle N (empty commit → pod Ready)
  2         CI success rate (last 20 runs)
  3         HTTP availability (100 reqs/endpoint)
  4         Monitoring coverage (kubectl top + influx)
  5 [N]     Reproducibility cycle N (destroy+apply+bootstrap)
  6         Secrets in repo (binary check)
  all       Run 2, 3, 4, 6 (skip 1 and 5, they push/destroy)
EOF
  exit 1
}

case "${1:-}" in
  1) kpi1_deploy_time "${2:-1}" ;;
  2) kpi2_pipeline ;;
  3) kpi3_availability ;;
  4) kpi4_monitoring ;;
  5) kpi5_reproducibility "${2:-1}" ;;
  6) kpi6_secrets ;;
  all)
    kpi2_pipeline
    kpi3_availability
    kpi4_monitoring
    kpi6_secrets
    ;;
  *) usage ;;
esac
