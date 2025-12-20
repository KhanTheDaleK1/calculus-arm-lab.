
document.addEventListener('DOMContentLoaded', () => {
    // Date check for snow effect
    const today = new Date();
    const currentMonth = today.getMonth(); // 0-indexed (0 = January)
    const currentDay = today.getDate();

    const isDecember = currentMonth === 11; // December
    const isJanuary = currentMonth === 0;   // January

    const december15 = 15;
    const january15 = 15;

    let showSnow = false;

    if ((isDecember && currentDay >= december15) || (isJanuary && currentDay <= january15)) {
        showSnow = true;
    }

    if (!showSnow) {
        return; // Exit if not within the snow display period
    }

    const SNOW_DURATION = 15 * 1000; // 15 seconds
    const FADE_OUT_DURATION = 2 * 1000; // 2 seconds for snow to fade out after SNOW_DURATION
    const NUMBER_OF_FLAKES = 50; // Adjust as needed
    const CONTAINER_ID = 'snow-container';
    const MOUND_ID = 'snow-mound';

    let snowContainer = document.getElementById(CONTAINER_ID);
    let snowMound = document.getElementById(MOUND_ID);

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

    if (!snowMound) {
        snowMound = document.createElement('div');
        snowMound.id = MOUND_ID;
        document.body.appendChild(snowMound);
        snowMound.style.opacity = '1'; // Make mound visible immediately
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

    // Start fading out snowContainer and snowMound after SNOW_DURATION
    setTimeout(() => {
        clearInterval(snowInterval); // Stop creating new snowflakes

        snowContainer.style.transition = `opacity ${FADE_OUT_DURATION / 1000}s ease-out`;
        snowContainer.style.opacity = '0';

        // snowMound should also start fading out
        snowMound.style.transition = `opacity ${FADE_OUT_DURATION / 1000}s ease-out`;
        snowMound.style.opacity = '0'; // Start fading out snow mound

        // Remove snowContainer and snowMound after fade out is complete
        setTimeout(() => {
            snowContainer.remove();
            snowMound.remove();
        }, FADE_OUT_DURATION);

    }, SNOW_DURATION);
});
