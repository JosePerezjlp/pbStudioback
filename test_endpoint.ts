import axios from 'axios';

async function testEndpoint() {
  try {
    console.log('🔐 Logging in...');
    
    // Login
    const loginResponse = await axios.post('http://localhost:3000/auth/login', {
      email: 'sachitaperi@gmail.com',
      password: 'Hola12345'
    });
    
    console.log('✅ Login successful!');
    console.log('Token:', loginResponse.data.token?.substring(0, 20) + '...');
    
    const token = loginResponse.data.token;
    
    // Call /users/me
    console.log('\n👤 Calling /users/me...');
    const meResponse = await axios.get('http://localhost:3000/users/me', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    console.log('✅ Success! User data:');
    console.log(JSON.stringify(meResponse.data, null, 2));
    
  } catch (error: any) {
    console.error('❌ Error:', error.response?.data || error.message);
    if (error.response?.status) {
      console.error('Status:', error.response.status);
    }
  }
}

testEndpoint();
