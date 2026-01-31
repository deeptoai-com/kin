#!/bin/bash
# Add 4GB swap file to prevent OOM during Docker builds
# Run on VPS: sudo bash scripts/add-swap.sh

set -e

SWAP_FILE="/swapfile"
SWAP_SIZE=4G

echo "=== Creating ${SWAP_SIZE} swap file ==="

# Check if swap already exists
if swapon --show | grep -q "${SWAP_FILE}"; then
    echo "Swap file already exists at ${SWAP_FILE}"
    exit 0
fi

# Create swap file
fallocate -l ${SWAP_SIZE} ${SWAP_FILE} || dd if=/dev/zero of=${SWAP_FILE} bs=1M count=4096
chmod 600 ${SWAP_FILE}
mkswap ${SWAP_FILE}
swapon ${SWAP_FILE}

# Add to fstab for persistence
echo "${SWAP_FILE} none swap sw 0 0" >> /etc/fstab

# Show swap status
echo "=== Swap enabled ==="
free -h
swapon --show

echo "=== Swappiness settings (recommended: 10 for VPS) ==="
sysctl vm.swappiness=10
echo "vm.swappiness=10" >> /etc/sysctl.conf
