#!/bin/bash
set -e

cd website && npm install && cd ..
cd crm/backend && npm install && npx prisma migrate deploy && npx prisma db seed && cd ../..
cd crm/frontend && npm install && npm run build && cd ../..

echo "✅ Done!"
