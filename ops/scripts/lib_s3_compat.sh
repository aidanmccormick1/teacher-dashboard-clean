#!/usr/bin/env bash

configure_s3_compat_cli() {
  export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-${S3_ACCESS_KEY_ID:-}}"
  export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-${S3_SECRET_ACCESS_KEY:-}}"
  export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-${S3_REGION:-auto}}"

  S3_ENDPOINT_ARGS=()
  if [[ -n "${S3_ENDPOINT:-}" ]]; then
    S3_ENDPOINT_ARGS=(--endpoint-url "${S3_ENDPOINT}")
  fi
}
