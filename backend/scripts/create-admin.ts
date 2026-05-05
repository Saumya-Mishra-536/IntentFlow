import { prisma } from '../src/utils/prisma';
// OOP: Encapsulation — prisma instance abstracts DB connection and queries

import { hashPassword } from '../src/utils/bcrypt';
// SRP: hashPassword is responsible only for hashing (good separation of concern)
// OOP: Abstraction — hides hashing algorithm details

async function main() {
    // SRP: These are configuration/seed values (could be externalized)
    const email = 'admin@relicwave.com';
    const name = 'admin';
    const password = 'admin1234';
    const app_role = 'admin';

    console.log(`Creating/updating admin account for ${email}...`);
    // SRP: logging concern (minor responsibility)

    try {
        // SRP: password hashing handled by dedicated function
        const hashedPassword = await hashPassword(password);

        // OOP: Encapsulation — DB operation via prisma, no raw SQL exposed
        // SRP: This block handles user persistence (create/update)
        const user = await prisma.user.upsert({
            where: { email },
            update: {
                name,
                password: hashedPassword,
                app_role: app_role as any, // ⚠️ Type safety bypass (not ideal)
            },
            create: {
                email,
                name,
                password: hashedPassword,
                app_role: app_role as any,
            },
        });

        console.log(`Successfully configured admin account!`);
        console.log(`User ID: ${user.id}`);
        console.log(`Email: ${user.email}`);
        console.log(`Role: ${user.app_role}`);
        // SRP: logging output

    } catch (error) {
        // SRP: error handling responsibility
        console.error('Failed to create admin account:', error);
    } finally {
        // OOP: Encapsulation of resource cleanup
        await prisma.$disconnect();

        // ⚠️ SRP violation (minor): process control mixed with business logic
        process.exit(0);
    }
}


main();
