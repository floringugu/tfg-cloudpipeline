resource "google_compute_address" "ingress_static" {
  name   = "tfg-ingress-static"
  region = var.region
}

output "ingress_static_ip" {
  value       = google_compute_address.ingress_static.address
  description = "Regional static IP bound to the nginx-ingress LoadBalancer"
}
