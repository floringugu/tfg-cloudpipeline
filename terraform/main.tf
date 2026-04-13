terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
  zone    = var.zone
}

resource "google_compute_network" "vpc" {
  name = "tfg-vpc"
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "subnet" {
  name = "tfg-subnet"
  ip_cidr_range = "10.0.0.0/24"
  region = var.region
  network = google_compute_network.vpc.id
}

resource "google_container_cluster" "gke" {
  name = var.cluster_name
  location = var.zone

  network = google_compute_network.vpc.name
  subnetwork = google_compute_subnetwork.subnet.name

  initial_node_count = var.node_count

  node_config {
    machine_type = "e2-medium"
    disk_size_gb = 30
  }

  deletion_protection = false
}
