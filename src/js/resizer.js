document.addEventListener('DOMContentLoaded', () => {
    const resizer = document.getElementById('dragMe');
    const leftSide = resizer.previousElementSibling;
    
    let x = 0;
    let leftWidth = 0;

    const mouseDownHandler = (e) => {
        x = e.clientX;
        leftWidth = leftSide.getBoundingClientRect().width;

        document.addEventListener('mousemove', mouseMoveHandler);
        document.addEventListener('mouseup', mouseUpHandler);
    };

    const mouseMoveHandler = (e) => {
        const dx = e.clientX - x;
        const newLeftWidth = leftWidth + dx;
        
        if (newLeftWidth >= 200 && newLeftWidth <= 600) {
            leftSide.style.width = `${newLeftWidth}px`;
        }
    };

    const mouseUpHandler = () => {
        document.removeEventListener('mousemove', mouseMoveHandler);
        document.removeEventListener('mouseup', mouseUpHandler);
    };

    resizer.addEventListener('mousedown', mouseDownHandler);
});