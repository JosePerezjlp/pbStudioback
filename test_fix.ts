import axios from 'axios';

async function testLogin() {
  try {
    console.log('Testing login with sachitaperi@gmail.com...\n');
    
    const response = await axios.post('http://localhost:3000/auth/login', {
      email: 'sachitaperi@gmail.com',
      password: 'Hola12345'
    });
    
    console.log('✅ Login successful!');
    console.log('Response:', JSON.stringify(response.data, null, 2));
    
    return response.data.token;
  } catch (error: any) {
    console.error('❌ Login failed');
    console.error('Error:', error.response?.data || error.message);
    return null;
  }
}

async function testUsersMe(token: string) {
  try {
    console.log('\n\nTesting /users/me endpoint...\n');
    
    const response = await axios.get('http://localhost:3000/users/me', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    console.log('✅ /users/me successful!');
    console.log('Response:', JSON.stringify(response.data, null, 2));
  } catch (error: any) {
    console.error('❌ /users/me failed');
    console.error('Status:', error.response?.status);
    console.error('Error:', error.response?.data || error.message);
  }
}

async function main() {
  const token = await testLogin();
  
  if (token) {
    await testUsersMe(token);
  }
}

main();
