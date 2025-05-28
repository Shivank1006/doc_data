try {
    // Your code that might throw
} catch (error: unknown) {
    // Option 1: Type guard with instanceof
    if (error instanceof Error) {
        console.error(error.message);
    } else {
        console.error(String(error));
    }
    
    // Option 2: Type assertion if you're confident about the type
    // const err = error as Error;
    // console.error(err.message);
    
    // Option 3: Convert to string directly
    // console.error(String(error));
}