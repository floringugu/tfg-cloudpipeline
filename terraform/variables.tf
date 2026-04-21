variable "project_id" {
  description = "ID del proyecto GCP"
  type = string
  default = "tfg-cloudpipeline"
}

variable "region" {
  description = "Región de GCP"
  type = string
  default = "europe-west1"
}

variable "zone" {
  description = "Zona de GCP"
  type = string
  default = "europe-west1-b"
}

variable "cluster_name" {
  description = "Nombre del clúster GKE"
  type = string
  default = "tfg-cluster"
}

variable "node_count" {
  description = "Número de nodos del clúster"
  type = number
  default = 3
}
