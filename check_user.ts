import prisma from './src/config/prisma';

async function checkUser() {
  try {
    const email = 'sachitaperi@gmail.com';
    console.log(`Looking for user: ${email}`);
    
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        enabled: true,
        roles: true,
      }
    });
    
    if (!user) {
      console.log('❌ User not found!');
    } else {
      console.log('✅ User found:', user);
      
      // Check transactions
      const transactions = await prisma.transaction.findMany({
        where: {
          userId: user.id,
          status: 1,
          isCompleted: true,
        },
        select: {
          id: true,
          packageType: true,
          packageTotalClasses: true,
          packageIsUnlimited: true,
          isExpired: true,
          expirationAt: true,
          packageId: true,
        },
        take: 5,
      });
      
      console.log(`\n📦 User has ${transactions.length} transactions`);
      transactions.forEach(tx => {
        console.log(`  - TX #${tx.id}: Type=${tx.packageType}, PackageId=${tx.packageId}, Classes=${tx.packageTotalClasses}, Unlimited=${tx.packageIsUnlimited}`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkUser();
