import { prisma } from '../src/utils/prisma';
// OOP: Encapsulation — prisma abstracts database operations

import { hashPassword } from '../src/utils/bcrypt';
// SRP: Responsible only for hashing passwords
// OOP: Abstraction — hides hashing implementation

async function main() {
    // ⚠️ SRP concern: Hardcoded configuration (should ideally come from env/config)
    const newPassword = 'vAbhi2678';

    console.log(`Setting default password for users without a password...`);
    // SRP: logging responsibility

    try {
        // SRP: hashing handled separately (good separation)
        const hashedPassword = await hashPassword(newPassword);

        // SRP: Fetch users with missing passwords
        const users = await prisma.user.findMany({
            where: {
                password: null
            }
        });

        console.log(`Found ${users.length} users needing a password update.`);
        // SRP: logging

        // SRP: Update user passwords
        for (const user of users) {
            await prisma.user.update({
                where: { id: user.id },
                data: { password: hashedPassword }
            });

            console.log(`Updated user: ${user.email}`);
            // SRP: logging per update
        }

        console.log(`Successfully updated passwords!`);
    } catch (error) {
        // SRP: error handling
        console.error('Failed to update passwords:', error);
    } finally {
        // OOP: Encapsulation — resource cleanup
        await prisma.$disconnect();

        // ⚠️ SRP violation (minor): process control mixed with business logic
        process.exit(0);
    }
}



main();
