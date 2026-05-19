describe('Flujo de Operador - Cotización y Creación', () => {
  it('debe iniciar sesión, cotizar y crear el envío en la web hosteada', () => {
    // 1. Ir a la página de login (usa la baseUrl de la configuración)
    cy.visit('/login');

    // 2. Iniciar sesión como operador
    // Verificá que los 'name' coincidan con tus inputs de React
    cy.get('input[name="username"]').type('op_caba'); 
    cy.get('input[name="password"]').type('op_caba123'); // <--- Poné tu clave real
    cy.get('button[type="submit"]').click();

    // 3. Confirmar que el login fue exitoso antes de seguir
    cy.url().should('not.include', '/login');

    // 4. Ir directamente a la pantalla de nuevo envío
    cy.visit('/new');

    // 5. Cargar datos del paquete (según tu captura de 10kg)
    cy.get('input[name="peso"]').clear().type('10');
    
    // 6. Ingresar direcciones para disparar el autocompletado
    cy.get('input[name="calleOrigen"]').type('Balcarce 500');
    cy.get('input[name="calleDestino"]').type('Avenida Vélez Sarsfield 361');

    // 7. Esperar a que la API de geolocalización responda y el precio se actualice
    cy.wait(1500); 
    
    // Validar el precio de la captura ($ 31.196)
    cy.get('.cotizacion-total').should('contain', '$ 31.196');

    // 8. Tildar el checkbox de "Entiendo que la sucursal está al límite"
    cy.get('input[type="checkbox"]').check();

    // 9. Hacer clic en el botón para finalizar el proceso
    cy.contains('Crear envío').click(); 

    // 10. Sacar la captura de pantalla de éxito para el informe
    cy.screenshot('evidencia-final-hosteada');
  });
});