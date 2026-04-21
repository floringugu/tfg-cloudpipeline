resource "google_storage_bucket" "pg_backups" {
  name                        = "${var.project_id}-pg-backups"
  location                    = var.region
  force_destroy               = true
  uniform_bucket_level_access = true

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      age = 30
    }
    action {
      type = "Delete"
    }
  }
}

resource "google_service_account" "postgres_backup" {
  account_id   = "postgres-backup"
  display_name = "Postgres backup CronJob"
}

resource "google_storage_bucket_iam_member" "backup_writer" {
  bucket = google_storage_bucket.pg_backups.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.postgres_backup.email}"
}

resource "google_service_account_iam_member" "backup_wi_binding" {
  service_account_id = google_service_account.postgres_backup.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "serviceAccount:${var.project_id}.svc.id.goog[data/postgres-backup]"
}

output "pg_backup_bucket" {
  value = google_storage_bucket.pg_backups.name
}

output "pg_backup_gsa_email" {
  value = google_service_account.postgres_backup.email
}
