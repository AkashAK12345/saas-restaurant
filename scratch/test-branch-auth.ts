import request from 'supertest';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const email = 'auditnormal@alpha.com';
  console.log(`Getting user for ${email}...`);
  const user = await prisma.user.findUnique({ where: { email } });
  
  if (!user) {
    console.error('User not found!');
    return;
  }
  
  // We need to login to get a fresh token!
  // We don't have the password easily... wait, the password is 'TestPassword123!' from the E2E script
  console.log('Logging in to get fresh token...');
  const loginRes = await fetch('http://localhost:3001/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'TestPassword123!' })
  });
  
  if (!loginRes.ok) {
    console.error('Login failed', await loginRes.text());
    return;
  }
  
  const { accessToken } = await loginRes.json();
  console.log('Got access token. Length:', accessToken.length);
  
  // Get Beta company ID
  const betaCompany = await prisma.company.findFirst({ where: { name: 'Beta Audit Corp' }});
  const betaCompanyId = betaCompany!.id;
  
  // Get Alpha HQ branch ID
  const alphaCompany = await prisma.company.findFirst({ where: { name: 'Alpha Audit Corp' }});
  const alphaHq = await prisma.branch.findFirst({ where: { company_id: alphaCompany!.id, name: 'HQ' }});
  const alphaHqId = alphaHq!.id;

  console.log(`\nTesting GET /api/v1/companies/${betaCompanyId}/branches`);
  const res1 = await fetch(`http://localhost:3001/api/v1/companies/${betaCompanyId}/branches`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'X-Company-ID': betaCompanyId
    }
  });
  console.log('Status:', res1.status);
  console.log('Body:', await res1.text());

  console.log(`\nTesting GET /api/v1/branches/${alphaHqId}`);
  const res2 = await fetch(`http://localhost:3001/api/v1/branches/${alphaHqId}`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'X-Company-ID': betaCompanyId
    }
  });
  console.log('Status:', res2.status);
  console.log('Body:', await res2.text());
}

main().catch(console.error).finally(() => prisma.$disconnect());
