
document.addEventListener('DOMContentLoaded', () => {
    const SNOW_DURATION = 15 * 1000; // 15 seconds
    const NUMBER_OF_FLAKES = 50; // Adjust as needed
    const CONTAINER_ID = 'snow-container';

    let snowContainer = document.getElementById(CONTAINER_ID);

    if (!snowContainer) {
        snowContainer = document.createElement('div');
        snowContainer.id = CONTAINER_ID;
        snowContainer.style.position = 'fixed';
        snowContainer.style.top = '0';
        snowContainer.style.left = '0';
        snowContainer.style.width = '100%';
        snowContainer.style.height = '100%';
        snowContainer.style.overflow = 'hidden';
        snowContainer.style.pointerEvents = 'none';
        snowContainer.style.zIndex = '9998'; // Below individual snowflakes
        document.body.appendChild(snowContainer);
    }

    const createSnowflake = () => {
        const snowflake = document.createElement('div');
        snowflake.classList.add('snowflake');

        const size = Math.random() * 5 + 2; // Size between 2px and 7px
        snowflake.style.width = `${size}px`;
        snowflake.style.height = `${size}px`;
        snowflake.style.left = `${Math.random() * 100}vw`; // Random horizontal position
        snowflake.style.animationDuration = `${Math.random() * 3 + 2}s`; // Fall duration between 2s and 5s
        snowflake.style.animationDelay = `${Math.random() * 5}s`; // Start at different times
        snowflake.style.animationName = 'fall'; // Ensure the correct animation is applied
        snowflake.style.animationFillMode = 'forwards'; // Stay at final state (opacity 0)
        snowflake.style.animationTimingFunction = 'linear';
        snowflake.style.opacity = Math.random() * 0.5 + 0.5; // Random opacity between 0.5 and 1

        snowContainer.appendChild(snowflake);

        // Remove snowflake after it falls to prevent DOM bloat
        snowflake.addEventListener('animationend', () => {
            snowflake.remove();
        });
    };

    // Generate snowflakes initially
    for (let i = 0; i < NUMBER_OF_FLAKES; i++) {
        createSnowflake();
    }

    // Continuously create snowflakes for the duration
    const snowInterval = setInterval(createSnowflake, 300); // Create a new snowflake every 300ms

    // Stop snow after SNOW_DURATION
    setTimeout(() => {
        clearInterval(snowInterval);
        // Optional: Remove existing snowflakes gracefully
        snowContainer.querySelectorAll('.snowflake').forEach(flake => {
            flake.style.animationDuration = '1s'; // Accelerate removal
            flake.style.opacity = '0';
            flake.addEventListener('animationend', () => flake.remove());
        });
        setTimeout(() => {
            snowContainer.remove();
        }, 1000); // Remove container after last flakes are gone
    }, SNOW_DURATION);
});
